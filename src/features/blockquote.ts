import { InputRule } from "prosemirror-inputrules";
import { TextSelection } from "prosemirror-state";
import { findWrapping } from "prosemirror-transform";

import type { FeatureSpec } from "./_types.ts";

// Blockquote — no draft concept; input rule commits immediately.
//
// Trigger: at the start of a paragraph, typing `>` then ` ` then any
// character (including space) wraps the paragraph into a blockquote.
// pretty renders a blockquote as `<bq>content</bq>` (multi-block
// children joined by `\n`) — the tag form is what distinguishes a real
// blockquote from a paragraph whose text happens to start with `> `.
//
// Enter behaviour inside a blockquote is fully handled by
// prosemirror-commands' baseKeymap (chainCommands of newlineInCode,
// createParagraphNear, liftEmptyBlock, splitBlock):
//   - non-empty line → splitBlock, new paragraph stays inside blockquote
//   - empty line     → liftEmptyBlock lifts the empty paragraph out of
//                      the blockquote, landing the cursor after it
// So this feature does not contribute a keymap.

// Input rule pattern: only fire once the user has typed `> ` PLUS a
// further character. The captured char then becomes the blockquote's
// first char — so a lone `> ` at the end of a paragraph is still a
// plain paragraph with text "> ", not yet a blockquote.
const BQ_INPUT_RE = /^> (.)$/;

export const blockquote: FeatureSpec = {
  name: "blockquote",

  inputRules: (schema) => [
    new InputRule(BQ_INPUT_RE, (state, match, start, end) => {
      const bqType = schema.nodes.blockquote;
      if (!bqType) return null;
      const trigger = match[1] ?? "";
      // Replace the `> ` prefix + the yet-to-be-inserted trigger char
      // with just the trigger char.
      const tr = state.tr.replaceWith(start, end, state.schema.text(trigger));
      // Resolve before the just-inserted trigger so blockRange wraps the
      // whole paragraph.
      const $start = tr.doc.resolve(start);
      const range = $start.blockRange();
      const wrapping = range && findWrapping(range, bqType);
      if (!wrapping) return null;
      tr.wrap(range, wrapping);
      // Land the cursor after the trigger char. Wrapping adds one level
      // of depth (one open token), so the cursor position shifts by +1.
      const cursor = start + 1 + trigger.length;
      tr.setSelection(TextSelection.create(tr.doc, cursor));
      return tr;
    }),
  ],

  cases: [
    {
      id: "immediate-wrap",
      label: "`> ` alone stays paragraph; next char wraps into blockquote",
      seed: "",
      events: [">", " ", "a"],
      checkpoints: [
        { at: 2, expect: "> |" },
        { at: 3, expect: "<bq>a|</bq>" },
      ],
    },

    {
      id: "immediate-wrap-space-trigger",
      label: "trigger char may itself be a space → blockquote with space content",
      seed: "",
      events: [">", " ", " "],
      checkpoints: [
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
