import type { Node as PMNode, Schema } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";

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
function tabCellNav(dir: 1 | -1) {
  return (state: import("prosemirror-state").EditorState,
    dispatch?: (tr: import("prosemirror-state").Transaction) => void): boolean => {
    const $from = state.selection.$from;
    let cellDepth = -1;
    for (let d = $from.depth; d >= 0; d--) {
      if ($from.node(d).type.name === "table_cell") {
        cellDepth = d;
        break;
      }
    }
    if (cellDepth === -1) return false;
    const rowDepth = cellDepth - 1;
    const tableDepth = cellDepth - 2;
    const cellIdx = $from.index(rowDepth);
    const rowIdx = $from.index(tableDepth);
    const tableNode = $from.node(tableDepth);
    const row = $from.node(rowDepth);

    let nextRow = rowIdx;
    let nextCell = cellIdx + dir;
    if (nextCell < 0) {
      nextRow = rowIdx - 1;
      if (nextRow < 0) return true; // first cell — consume, no-op
      nextCell = tableNode.child(nextRow).childCount - 1;
    } else if (nextCell >= row.childCount) {
      nextRow = rowIdx + 1;
      if (nextRow >= tableNode.childCount) return true; // last cell — consume, no-op
      nextCell = 0;
    }
    if (dispatch) {
      const tableStart = $from.before(tableDepth);
      let pos = tableStart + 1; // inside table
      for (let r = 0; r < nextRow; r++) pos += tableNode.child(r).nodeSize;
      pos += 1; // inside row
      const targetRow = tableNode.child(nextRow);
      for (let c = 0; c < nextCell; c++) pos += targetRow.child(c).nodeSize;
      pos += 1; // inside cell
      dispatch(
        state.tr.setSelection(TextSelection.create(state.doc, pos)),
      );
    }
    return true;
  };
}

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

  keymap: (schema: Schema) => ({
    // Cell navigation. Tab / Shift-Tab move the cursor row-major; at the
    // boundary (last/first cell) the keystroke is consumed but the
    // selection is unchanged — that matches Typora and avoids letting
    // browser focus escape the table.
    Tab: tabCellNav(1),
    "Shift-Tab": tabCellNav(-1),

    // Live trigger: a paragraph whose text is exactly `|c1|c2|...|`
    // (≥ 2 cells, leading + trailing pipes) commits to a table on Enter.
    // Cells split on `|`; first and last segments (empty by construction)
    // are dropped; middle segments — including empty ones — become cells
    // verbatim (trimmed).
    Enter: (state, dispatch) => {
      const sel = state.selection;
      if (!sel.empty) return false;
      const $from = sel.$from;
      if ($from.parent.type.name !== "paragraph") return false;
      const text = $from.parent.textContent;
      if (!/^\|.+\|$/.test(text)) return false;
      const parts = text.split("|");
      // Leading + trailing `|` always produce empty first/last entries.
      const cells = parts.slice(1, -1).map((c) => c.trim());
      if (cells.length < 2) return false;

      if (dispatch) {
        const headerRow = schema.nodes.table_row.create(
          null,
          cells.map((c) =>
            schema.nodes.table_cell.create(
              { header: true, align: null },
              c ? [schema.text(c)] : [],
            ),
          ),
        );
        const bodyRow = schema.nodes.table_row.create(
          null,
          cells.map(() =>
            schema.nodes.table_cell.create(
              { header: false, align: null },
              [],
            ),
          ),
        );
        const tableNode = schema.nodes.table.create(null, [headerRow, bodyRow]);

        const paraStart = $from.before();
        const paraEnd = $from.after();
        const tr = state.tr;
        tr.replaceWith(paraStart, paraEnd, tableNode);
        // Cursor inside first body cell. Position: paraStart (= table
        // start) + 1 (table open) + headerRow.nodeSize + 1 (body row open)
        // + 1 (first cell open).
        const firstBodyCell = paraStart + 1 + headerRow.nodeSize + 2;
        tr.setSelection(TextSelection.create(tr.doc, firstBodyCell));
        dispatch(tr);
      }
      return true;
    },
  }),

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
      id: "commit-2-col",
      label: "|a|b|<Enter> commits to 2-col table with empty body row",
      seed: "",
      events: ["|", "a", "|", "b", "|", "<Enter>"],
      checkpoints: [
        { at: 5, expect: "|a|b||" },
        {
          at: 6,
          expect:
            "<table><tr><th>a</th><th>b</th></tr><tr><td>|</td><td></td></tr></table>",
        },
      ],
    },
    {
      id: "commit-3-col-empty-middle",
      label: "|a||b|<Enter> commits to 3 cols with empty middle header",
      seed: "",
      events: ["|", "a", "|", "|", "b", "|", "<Enter>"],
      checkpoints: [
        {
          at: 7,
          expect:
            "<table><tr><th>a</th><th></th><th>b</th></tr><tr><td>|</td><td></td><td></td></tr></table>",
        },
      ],
    },
    {
      id: "tab-nav",
      label: "Tab moves cursor through cells row-major; last cell stays put",
      // Build a 2x2 table via commit, then Tab through the cells.
      seed: "",
      events: [
        "|", "a", "|", "b", "|", "<Enter>", // header [a, b], body [_, _], cursor in body[0]
        "x",                                  // body[0] = "x"
        "<Tab>",                              // → body[1]
        "y",                                  // body[1] = "y"
        "<Tab>",                              // last cell → no-op
      ],
      checkpoints: [
        // After commit, cursor in body[0].
        {
          at: 6,
          expect:
            "<table><tr><th>a</th><th>b</th></tr><tr><td>|</td><td></td></tr></table>",
        },
        // Type "x".
        {
          at: 7,
          expect:
            "<table><tr><th>a</th><th>b</th></tr><tr><td>x|</td><td></td></tr></table>",
        },
        // Tab → body[1].
        {
          at: 8,
          expect:
            "<table><tr><th>a</th><th>b</th></tr><tr><td>x</td><td>|</td></tr></table>",
        },
        // Type "y".
        {
          at: 9,
          expect:
            "<table><tr><th>a</th><th>b</th></tr><tr><td>x</td><td>y|</td></tr></table>",
        },
        // Last cell + Tab → cursor unchanged.
        {
          at: 10,
          expect:
            "<table><tr><th>a</th><th>b</th></tr><tr><td>x</td><td>y|</td></tr></table>",
        },
      ],
    },
    {
      id: "shift-tab-nav",
      label: "Shift-Tab moves cursor backwards; first cell stays put",
      seed: "",
      events: [
        "|", "a", "|", "b", "|", "<Enter>", // body[0]
        "<Shift-Tab>",                        // → header[1]
        "<Shift-Tab>",                        // → header[0]
        "<Shift-Tab>",                        // first cell → no-op
      ],
      checkpoints: [
        // body[0] → header[1].
        {
          at: 7,
          expect:
            "<table><tr><th>a</th><th>|b</th></tr><tr><td></td><td></td></tr></table>",
        },
        // header[1] → header[0].
        {
          at: 8,
          expect:
            "<table><tr><th>|a</th><th>b</th></tr><tr><td></td><td></td></tr></table>",
        },
        // First cell + Shift-Tab → cursor unchanged.
        {
          at: 9,
          expect:
            "<table><tr><th>|a</th><th>b</th></tr><tr><td></td><td></td></tr></table>",
        },
      ],
    },
    {
      id: "single-col-no-trigger",
      label: "|a|<Enter> doesn't trigger (need ≥ 2 cols)",
      seed: "",
      events: ["|", "a", "|", "<Enter>"],
      checkpoints: [
        // Plain Enter splits the paragraph; no table.
        { at: 4, expect: "|a|\n|" },
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
