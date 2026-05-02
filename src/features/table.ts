import type { Node as PMNode } from "prosemirror-model";

import type { FeatureSpec } from "./_types.ts";

// GFM table — phase 1 (parse / serialize / display only). Live editor
// input (typing `| col |` etc.) and cell navigation (Tab between cells,
// add row / column buttons) are deferred to phase 2.
//
// Schema:
//   table → table_row+ → table_cell+
//   table_cell carries `{header: boolean, align: "left"|"center"|"right"|null}`
//   (alignment from the GFM `:---:` divider; header inferred from
//   md-it's th_open vs td_open tokens — first row's cells carry it).
//
// Round-trip: doc-level only. md-it produces resolved tokens; we emit
// canonical `| col1 | col2 |\n| --- | --- |\n| ... |` shape on save.
// Bare-pipe and column-width-padded variants are accepted on input;
// output is normalized.

function parseAlignFromStyle(style: string | null): string | null {
  if (!style) return null;
  // Browsers / happy-dom may canonicalize with a space after `:` and a
  // trailing semicolon — match either form.
  const m = /text-align:\s*(left|center|right)/.exec(style);
  return m ? m[1]! : null;
}

function alignDelim(align: string | null, width: number): string {
  // Min divider width is 3 (per GFM); we expand to match content width
  // so the source is human-readable on save.
  const w = Math.max(3, width);
  if (align === "left") return ":" + "-".repeat(w - 1);
  if (align === "right") return "-".repeat(w - 1) + ":";
  if (align === "center") return ":" + "-".repeat(w - 2) + ":";
  return "-".repeat(w);
}

// Precompute the inline serialization of a cell — needed twice (column
// width measurement, then actual emission). We render via the same
// inline serializer the rest of the doc uses, but into a sandbox so
// pmPos/markers from the outer state don't leak.
function renderCellInline(cell: PMNode): string {
  // Minimal cell-content serializer — covers method-B marks (delim chars
  // already live in textContent) and avoids the circular import with
  // serializer.ts. Inline atom nodes inside cells (image, etc.) are
  // skipped for the pilot; phase 2 can route them through the full
  // serializer if/when atoms in tables become a real use case.
  let out = "";
  cell.content.forEach((child) => {
    if (child.isText) out += child.text ?? "";
  });
  // Pipes inside cells are GFM-escaped as `\|`.
  return out.replace(/\|/g, "\\|");
}

export const table: FeatureSpec = {
  name: "table",

  nodes: {
    table: {
      group: "block",
      content: "table_row+",
      defining: true,
      isolating: true,
      parseDOM: [{ tag: "table" }],
      toDOM: () => ["table", ["tbody", 0]],
    },
    table_row: {
      content: "table_cell+",
      parseDOM: [{ tag: "tr" }],
      toDOM: () => ["tr", 0],
    },
    table_cell: {
      content: "inline*",
      attrs: {
        header: { default: false },
        align: { default: null },
      },
      isolating: true,
      parseDOM: [
        {
          tag: "th",
          getAttrs: (el) => ({
            header: true,
            align: parseAlignFromStyle((el as HTMLElement).getAttribute("style")),
          }),
        },
        {
          tag: "td",
          getAttrs: (el) => ({
            header: false,
            align: parseAlignFromStyle((el as HTMLElement).getAttribute("style")),
          }),
        },
      ],
      toDOM: (node) => {
        const tag = node.attrs.header ? "th" : "td";
        const align = node.attrs.align as string | null;
        const attrs = align ? { style: `text-align:${align}` } : {};
        return [tag, attrs, 0];
      },
    },
  },

  mdItPlugins: [(md) => md.enable("table")],

  parserTokens: {
    table_open: (state, _tok, schema) => {
      state.openNode(schema.nodes.table);
    },
    table_close: (state) => {
      state.closeNode();
    },
    // thead/tbody are wrappers in md-it but our schema is flat — skip them.
    thead_open: () => {},
    thead_close: () => {},
    tbody_open: () => {},
    tbody_close: () => {},
    tr_open: (state, _tok, schema) => {
      state.openNode(schema.nodes.table_row);
    },
    tr_close: (state) => {
      state.closeNode();
    },
    th_open: (state, tok, schema) => {
      const align = parseAlignFromStyle(tok.attrGet("style"));
      state.openNode(schema.nodes.table_cell, { header: true, align });
    },
    th_close: (state) => {
      state.closeNode();
    },
    td_open: (state, tok, schema) => {
      const align = parseAlignFromStyle(tok.attrGet("style"));
      state.openNode(schema.nodes.table_cell, { header: false, align });
    },
    td_close: (state) => {
      state.closeNode();
    },
  },

  blockHandlers: {
    table: (state, node) => {
      // Render every cell first so we can measure column widths and
      // emit nicely padded source on save. Two-pass (measure → emit).
      const rows: string[][] = [];
      const aligns: Array<string | null> = [];
      node.forEach((row, _, rowIdx) => {
        const cells: string[] = [];
        row.forEach((cell, _o, cellIdx) => {
          if (rowIdx === 0) aligns[cellIdx] = cell.attrs.align as string | null;
          cells.push(renderCellInline(cell));
        });
        rows.push(cells);
      });

      const colCount = aligns.length;
      const widths = new Array<number>(colCount).fill(3);
      for (const r of rows)
        for (let i = 0; i < colCount; i++)
          widths[i] = Math.max(widths[i]!, (r[i] ?? "").length);

      const formatRow = (cells: string[]): string => {
        const padded = cells.map((c, i) => " " + c.padEnd(widths[i]!) + " ");
        return "|" + padded.join("|") + "|";
      };
      const dividerRow = (): string => {
        const dividers = aligns.map((a, i) => " " + alignDelim(a, widths[i]!) + " ");
        return "|" + dividers.join("|") + "|";
      };

      // Header row → divider → body rows.
      state.write(formatRow(rows[0] ?? []));
      state.out += "\n";
      if (state.delim) state.out += state.delim;
      state.out += dividerRow();
      for (let i = 1; i < rows.length; i++) {
        state.out += "\n";
        if (state.delim) state.out += state.delim;
        state.out += formatRow(rows[i]!);
      }
      state.closeBlock(node);
    },
  },

  renderCases: {
    table: (children) => `<table>${children}</table>`,
    tr: (children) => `<tr>${children}</tr>`,
    th: (children, el) => {
      const align = parseAlignFromStyle(el.getAttribute("style"));
      const attr = align ? `:${align}` : "";
      return `<th${attr}>${children}</th>`;
    },
    td: (children, el) => {
      const align = parseAlignFromStyle(el.getAttribute("style"));
      const attr = align ? `:${align}` : "";
      return `<td${attr}>${children}</td>`;
    },
  },

  cases: [
    {
      id: "parse-basic",
      label: "basic 2x2 table parses to <table> structure",
      seed: "| col1 | col2 |\n| --- | --- |\n| a | b |",
      events: [],
      checkpoints: [
        {
          at: 0,
          expect:
            "<table><tr><th>col1</th><th>col2</th></tr><tr><td>a</td><td>b|</td></tr></table>",
        },
      ],
    },
    {
      id: "parse-aligned",
      label: "alignment markers — `:---:` center, `---:` right, `:---` left",
      seed: "| L | C | R |\n| :--- | :---: | ---: |\n| a | b | c |",
      events: [],
      checkpoints: [
        {
          at: 0,
          expect:
            "<table><tr><th:left>L</th><th:center>C</th><th:right>R</th></tr><tr><td:left>a</td><td:center>b</td><td:right>c|</td></tr></table>",
        },
      ],
    },
    {
      id: "parse-inline-marks-in-cell",
      label: "cell content keeps inline marks (em, strong, code)",
      seed: "| a | b |\n| --- | --- |\n| **bold** | `code` |",
      events: [],
      checkpoints: [
        // Cursor lands at the right edge of the last cell (atEnd of
        // doc) — that's inside the surrounding span of the `code` mark,
        // so the closing backtick shows as gray. This is the same
        // method-B convention as in inline cases (strike-tilde etc.).
        {
          at: 0,
          expect:
            "<table><tr><th>a</th><th>b</th></tr><tr><td><b>bold</b></td><td><g>`</g><c>code</c><g>`</g>|</td></tr></table>",
        },
      ],
    },
  ],
};
