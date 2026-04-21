import type { FeatureSpec } from "./_types.ts";

// Blockquote — no draft concept; input rule commits immediately.
//
// Trigger: at the start of a paragraph, typing `>` then ` ` then any
// character (including space) wraps the paragraph into a blockquote.
// pretty renders a blockquote as `<bq>content</bq>` (multi-block
// children joined by `\n`) — the tag form is what distinguishes a real
// blockquote from a paragraph whose text happens to start with `> `.
//
// Enter behaviour inside a blockquote:
//   - non-empty line → split, new line stays inside blockquote
//   - empty line     → exit: remove the empty line, cursor lands in a
//                      new paragraph after the blockquote
//
// Backspace behaviour (not fully exercised in stubs here):
//   - emptying the only line keeps the blockquote (serialises to `> `)
//   - one more Backspace unwraps the empty blockquote to paragraph
//
// OPEN QUESTIONS / flags:
//   - seed-based cases rely on core parser handling multi-line
//     blockquotes. The mid-line Enter split case is flagged — adjust
//     seed / expect shape once parser layout confirmed.
//   - Backspace-unwrap at end of life (emptied blockquote) is not
//     included: depends on seed parse + keymap wiring that isn't
//     spec'd yet.
export const blockquote: FeatureSpec = {
  name: "blockquote",

  cases: [
    {
      id: "immediate-wrap",
      label: "`> ` alone stays paragraph; next char wraps into blockquote",
      seed: "",
      events: [">", " ", "a"],
      checkpoints: [
        // at=2: still paragraph with text `> ` — no trigger yet, no <bq>.
        { at: 2, expect: "> |" },
        // at=3: input rule fires, wraps paragraph into blockquote,
        // paragraph content is now just "a".
        { at: 3, expect: "<bq>a|</bq>" },
      ],
    },

    {
      id: "immediate-wrap-space-trigger",
      label: "trigger char may itself be a space → blockquote with space content",
      seed: "",
      events: [">", " ", " "],
      checkpoints: [
        // at=3: blockquote wrapping a paragraph whose content is a
        // single space char.
        { at: 3, expect: "<bq> |</bq>" },
      ],
    },

    {
      id: "non-space-trigger",
      label: "trigger char can be any non-space char (e.g. `x`)",
      seed: "",
      events: [">", " ", "x"],
      checkpoints: [
        { at: 3, expect: "<bq>x|</bq>" },
      ],
    },

    {
      id: "enter-extends",
      label: "Enter inside non-empty blockquote line → new blockquote line",
      seed: "",
      events: [">", " ", "a", "<Enter>", "b"],
      checkpoints: [
        { at: 3, expect: "<bq>a|</bq>" },
        // Second paragraph appears inside same blockquote (joined by \n).
        { at: 4, expect: "<bq>a\n|</bq>" },
        { at: 5, expect: "<bq>a\nb|</bq>" },
      ],
    },

    {
      id: "enter-on-empty-line-exits",
      label: "Enter on an empty blockquote line → exit blockquote",
      seed: "",
      events: [">", " ", "a", "<Enter>", "<Enter>"],
      checkpoints: [
        { at: 4, expect: "<bq>a\n|</bq>" },
        // Empty second line removed + cursor lands in a new paragraph
        // outside the blockquote. Block separator is `\n` between
        // top-level blocks, so blockquote + empty paragraph pretty is:
        { at: 5, expect: "<bq>a</bq>\n|" },
      ],
    },

    {
      id: "mid-line-enter-splits",
      label: "Enter in the middle of a blockquote line → split, both halves stay inside",
      // Pre-existing single-line blockquote; caret lands between `a`
      // and `b` via Home + ArrowRight, then Enter splits the paragraph
      // but keeps both halves inside the same blockquote.
      seed: "> ab",
      events: ["<Home>", "<ArrowRight>", "<Enter>"],
      checkpoints: [
        { at: 3, expect: "<bq>a\n|b</bq>" },
      ],
    },
  ],
};
