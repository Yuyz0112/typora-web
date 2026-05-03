import type { FeatureSpecs } from "../_types.ts";
import { parseAlignFromStyle } from "../../src/features/table.ts";

export const tableSpecs: FeatureSpecs = {
  name: "table",
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
      id: "mod-enter-adds-row-below",
      label: "Mod-Enter inside a cell adds an empty row below; cursor moves there",
      seed: "",
      events: [
        "|", "a", "|", "b", "|", "<Enter>", // 2x2: header [a,b], one empty body row, cursor in body[0]
        "x",                                  // body[0] = "x"
        "<Mod-Enter>",                        // add row below; cursor → new row, col 0
        "z",                                  // new row col 0 = "z"
      ],
      checkpoints: [
        // After Mod-Enter: 3 rows; cursor in new (3rd) row, col 0.
        {
          at: 8,
          expect:
            "<table><tr><th>a</th><th>b</th></tr><tr><td>x</td><td></td></tr><tr><td>|</td><td></td></tr></table>",
        },
        {
          at: 9,
          expect:
            "<table><tr><th>a</th><th>b</th></tr><tr><td>x</td><td></td></tr><tr><td>z|</td><td></td></tr></table>",
        },
      ],
    },
    {
      id: "mod-shift-backspace-deletes-row",
      label: "Mod-Shift-Backspace deletes the current row",
      seed: "",
      events: [
        "|", "a", "|", "b", "|", "<Enter>", // 2x2: header + 1 body row, cursor in body[0]
        "x",                                  // body[0] = "x"
        "<Mod-Enter>",                        // 3 rows total; cursor in new row 0,0
        "y",                                  // new row [y, _]
        "<Mod-Shift-Backspace>",              // delete current (3rd) row → cursor falls back to prev row
      ],
      checkpoints: [
        {
          at: 9,
          expect:
            "<table><tr><th>a</th><th>b</th></tr><tr><td>x</td><td></td></tr><tr><td>y|</td><td></td></tr></table>",
        },
        // Delete last row → 2 rows (header + body). Cursor in the now-last row, same col (0).
        {
          at: 10,
          expect:
            "<table><tr><th>a</th><th>b</th></tr><tr><td>|x</td><td></td></tr></table>",
        },
      ],
    },
    {
      id: "mod-shift-backspace-only-row-noop",
      label: "Mod-Shift-Backspace on a 1-row table is a no-op (use trash to delete)",
      // Build a header-only table by deleting the body row of a 2-row table.
      seed: "",
      events: [
        "|", "a", "|", "b", "|", "<Enter>", // header + 1 body row, cursor in body[0]
        "<Mod-Shift-Backspace>",              // delete body[0] → header-only
        "<Mod-Shift-Backspace>",              // try delete header → no-op
      ],
      checkpoints: [
        // After first delete: header-only, cursor in header[0] (same column).
        {
          at: 7,
          expect:
            "<table><tr><th>|a</th><th>b</th></tr></table>",
        },
        // Second delete is consumed but does nothing.
        {
          at: 8,
          expect:
            "<table><tr><th>|a</th><th>b</th></tr></table>",
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
