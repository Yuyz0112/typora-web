import type { FeatureSpec } from "./_types.ts";

// Blockquote — no draft concept; input rule commits immediately.
//
// Trigger: at the start of a paragraph, typing `>` then ` ` then any
// character (including space) wraps the paragraph into a blockquote.
// The `> ` prefix itself is not content — it is rendered by test-pretty
// as a `> ` prefix on every line of the blockquote's children.
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
//   - "at=2 expect `> |`" — at the trigger moment before the third
//     char, doc is still a plain paragraph whose textContent is `> `.
//     pretty() projects the paragraph as `> |`. If normalize ends up
//     hiding the leading `> ` as a syntax-hint (method-B style), the
//     expect string may differ. Flagged; adjust once implementation
//     lands.
//   - Blockquote content that begins with a literal space: `>  x`
//     (two spaces, the 2nd being the trigger char and also the first
//     content char) — test-pretty emits `>  x|` (blockquote prefix `> `
//     plus a leading space inside). Confirm this is desired.
//   - seed-based cases (`seed: "> a\n> b"`) rely on core parser
//     handling multi-line blockquotes. The mid-line Enter split case
//     is included but flagged — implementation may lean on PM's
//     splitBlock and this expect might need tweaking.
//   - Backspace-unwrap at end of life (emptied blockquote) is not
//     included in stubs: depends on seed parse + keymap wiring that
//     isn't spec'd yet. Flagged for a follow-up round.
export const blockquote: FeatureSpec = {
  name: "blockquote",

  cases: [
    {
      id: "immediate-wrap",
      label: "`> ` alone stays paragraph; next char wraps into blockquote",
      seed: "",
      events: [">", " ", "a"],
      checkpoints: [
        // at=2: still paragraph, text `> ` — `> ` prefix is NOT yet
        // interpreted as blockquote markup (no third char yet).
        // FLAG: if normalize treats `> ` specially at this point, revise.
        { at: 2, expect: "> |" },
        // at=3: input rule fires, wraps paragraph into blockquote,
        // content becomes "a", cursor after it.
        { at: 3, expect: "> a|" },
      ],
    },

    {
      id: "immediate-wrap-space-trigger",
      label: "trigger char may itself be a space → blockquote with space content",
      seed: "",
      events: [">", " ", " "],
      checkpoints: [
        // at=3: blockquote wrapping paragraph whose content is a single
        // space. test-pretty blockquote prefix is `> `, plus the space
        // of content → `>  |` (two spaces before the caret).
        { at: 3, expect: ">  |" },
      ],
    },

    {
      id: "non-space-trigger",
      label: "trigger char can be any non-space char (e.g. `x`)",
      seed: "",
      events: [">", " ", "x"],
      checkpoints: [
        { at: 3, expect: "> x|" },
      ],
    },

    {
      id: "enter-extends",
      label: "Enter inside non-empty blockquote line → new blockquote line",
      seed: "",
      events: [">", " ", "a", "<Enter>", "b"],
      checkpoints: [
        // at=3: wrapped, cursor after `a`
        { at: 3, expect: "> a|" },
        // at=4: split, new empty line inside blockquote
        { at: 4, expect: "> a\n> |" },
        // at=5: typed `b` on the new line
        { at: 5, expect: "> a\n> b|" },
      ],
    },

    {
      id: "enter-on-empty-line-exits",
      label: "Enter on an empty blockquote line → exit blockquote",
      seed: "",
      events: [">", " ", "a", "<Enter>", "<Enter>"],
      checkpoints: [
        // at=4: blockquote with two lines, second is empty
        { at: 4, expect: "> a\n> |" },
        // at=5: empty second line is removed and cursor lands in a new
        // paragraph outside the blockquote.
        // FLAG: exact pretty form of "blockquote followed by empty
        // paragraph" — test-pretty joins blocks with `\n`. Expect:
        //   `> a` (one-line blockquote) + `\n` + `|` (empty paragraph
        //   with caret). Revise if block separator differs.
        { at: 5, expect: "> a\n|" },
      ],
    },

    {
      id: "mid-line-enter-splits",
      label: "Enter in the middle of a blockquote line → split, both halves stay inside",
      // Seed is a pre-existing two-line blockquote. Relies on core
      // parser handling `> a\n> b` as a single blockquote node with a
      // paragraph containing `a\nb` (or two paragraphs — depends on
      // parser). FLAG: adjust seed / expect once parser shape confirmed.
      seed: "> ab",
      // Place caret between `a` and `b`: Home, ArrowRight (past `a`).
      // Using Home + ArrowRight to avoid depending on initial cursor
      // position; revisit if setup puts cursor at end by default.
      events: ["<Home>", "<ArrowRight>", "<Enter>"],
      checkpoints: [
        // FLAG: expect shape depends on whether the split stays inside
        // the blockquote (desired) or escapes. Desired outcome:
        { at: 3, expect: "> a\n> |b" },
      ],
    },
  ],
};
