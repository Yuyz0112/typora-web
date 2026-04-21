import { wrappingInputRule } from "prosemirror-inputrules";

import type { FeatureSpec } from "./_types.ts";

// Blockquote — no draft concept; input rule commits immediately.
//
// Trigger: at the start of a paragraph, typing `>` then ` ` (space)
// wraps the paragraph into a blockquote. The space is the trigger —
// `>` alone is still plain text, but `> ` IS the blockquote. pretty
// renders a blockquote as `<bq>content</bq>` (multi-block children
// joined by `\n`) — the tag form is what distinguishes a real
// blockquote from a paragraph whose text happens to start with `> `.
//
// Enter behaviour inside a blockquote is fully handled by
// prosemirror-commands' baseKeymap (chainCommands of newlineInCode,
// createParagraphNear, liftEmptyBlock, splitBlock):
//   - non-empty line → splitBlock, new paragraph stays inside blockquote
//   - empty line     → liftEmptyBlock lifts the empty paragraph out of
//                      the blockquote, landing the cursor after it
// So this feature does not contribute a keymap.

export const blockquote: FeatureSpec = {
  name: "blockquote",

  inputRules: (schema) => [
    // `wrappingInputRule(/^> $/, type)` fires the moment the paragraph
    // text becomes exactly "> " — i.e. when the user types the space.
    // PM's wrapping helper strips the matched `> ` text and wraps the
    // paragraph in a blockquote, landing the cursor at the start of the
    // now-empty inner paragraph.
    wrappingInputRule(/^> $/, schema.nodes.blockquote),
  ],

  cases: [
    {
      id: "immediate-wrap",
      label: "`>` alone stays paragraph; space triggers wrap",
      seed: "",
      events: [">", " ", "a"],
      checkpoints: [
        // at=1: text `>`, plain paragraph.
        { at: 1, expect: ">|" },
        // at=2: space fires the input rule; blockquote with empty
        // paragraph inside, cursor at the start.
        { at: 2, expect: "<bq>|</bq>" },
        // at=3: typed `a` inside the blockquote paragraph.
        { at: 3, expect: "<bq>a|</bq>" },
      ],
    },

    {
      id: "content-can-start-with-space",
      label: "first content char can be a space",
      seed: "",
      events: [">", " ", " "],
      checkpoints: [
        { at: 2, expect: "<bq>|</bq>" },
        { at: 3, expect: "<bq> |</bq>" },
      ],
    },

    {
      id: "non-space-first-content",
      label: "first content char can be any non-space (e.g. `x`)",
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
        { at: 5, expect: "<bq>a</bq>\n|" },
      ],
    },

    {
      id: "mid-line-enter-splits",
      label: "Enter in the middle of a blockquote line → split, both halves stay inside",
      seed: "> ab",
      events: ["<Home>", "<ArrowRight>", "<Enter>"],
      checkpoints: [
        { at: 3, expect: "<bq>a\n|b</bq>" },
      ],
    },
  ],
};
