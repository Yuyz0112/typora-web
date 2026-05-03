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

};
