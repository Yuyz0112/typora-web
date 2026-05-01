import { Plugin, TextSelection } from "prosemirror-state";
import type { Command } from "prosemirror-state";
import type { Schema } from "prosemirror-model";

import type { FeatureSpec } from "./_types.ts";

// Auto-pair: typing `[` or `(` inserts the matching close char and parks
// the cursor between them, but only when the cursor is at end-of-line or
// directly before whitespace. Inside running text it stays single-char so
// regular prose isn't mangled.
//
// Backspace inside an empty pair (`[|]` or `(|)`) deletes both chars in
// one go — undoing the auto-pair as a single user action.

const PAIRS: Record<string, string> = { "[": "]", "(": ")" };
const CLOSERS = new Set(["]", ")"]);

function shouldAutoPair(after: string): boolean {
  return after.length === 0 || /^\s/.test(after);
}

function autoPairInputPlugin(): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (from !== to) return false;
        const $from = view.state.doc.resolve(from);
        if (!$from.parent.isTextblock) return false;
        const offset = $from.parentOffset;
        const size = $from.parent.content.size;
        const nextChar =
          offset < size ? $from.parent.textBetween(offset, offset + 1) : "";
        // Skip-over: typing a closer that matches the next char just moves
        // the cursor past it, instead of inserting a duplicate. Pairs well
        // with auto-pair so e.g. `[a](b)` types end-to-end without leaving
        // stranded chars.
        if (CLOSERS.has(text) && nextChar === text) {
          const tr = view.state.tr.setSelection(
            TextSelection.create(view.state.doc, from + 1),
          );
          view.dispatch(tr);
          return true;
        }
        const close = PAIRS[text];
        if (!close) return false;
        const after = $from.parent.textBetween(offset, size);
        if (!shouldAutoPair(after)) return false;
        const tr = view.state.tr.insertText(text + close, from, to);
        tr.setSelection(TextSelection.create(tr.doc, from + 1));
        view.dispatch(tr);
        return true;
      },
    },
  });
}

const backspaceClearPair: Command = (state, dispatch) => {
  const sel = state.selection;
  if (!sel.empty) return false;
  const $from = state.doc.resolve(sel.from);
  if (!$from.parent.isTextblock) return false;
  const offset = $from.parentOffset;
  const size = $from.parent.content.size;
  if (offset === 0 || offset === size) return false;
  const before = $from.parent.textBetween(offset - 1, offset);
  const after = $from.parent.textBetween(offset, offset + 1);
  const matches =
    (before === "[" && after === "]") || (before === "(" && after === ")");
  if (!matches) return false;
  if (dispatch) dispatch(state.tr.delete(sel.from - 1, sel.from + 1));
  return true;
};

export const autoPair: FeatureSpec = {
  name: "auto_pair",

  plugins: () => [autoPairInputPlugin()],

  keymap: (_schema: Schema) => ({
    Backspace: backspaceClearPair,
  }),

  cases: [
    {
      id: "bracket-at-eol",
      label: "[ at end of line auto-pairs to []",
      seed: "",
      events: ["["],
      checkpoints: [{ at: 1, expect: "[|]" }],
    },
    {
      id: "paren-at-eol",
      label: "( at end of line auto-pairs to ()",
      seed: "",
      events: ["("],
      checkpoints: [{ at: 1, expect: "(|)" }],
    },
    {
      id: "bracket-before-space",
      label: "[ before space still auto-pairs",
      seed: "",
      events: [" ", "<Home>", "["],
      checkpoints: [{ at: 3, expect: "[|] " }],
    },
    {
      id: "bracket-before-letter-no-pair",
      label: "[ before a letter does NOT auto-pair",
      seed: "",
      events: ["a", "b", "<ArrowLeft>", "["],
      checkpoints: [
        { at: 3, expect: "a|b" },
        { at: 4, expect: "a[|b" },
      ],
    },
    {
      id: "backspace-empties-bracket-pair",
      label: "Backspace inside empty [] removes both chars",
      seed: "",
      events: ["[", "<Backspace>"],
      checkpoints: [
        { at: 1, expect: "[|]" },
        { at: 2, expect: "|" },
      ],
    },
    {
      id: "backspace-empties-paren-pair",
      label: "Backspace inside empty () removes both chars",
      seed: "",
      events: ["(", "<Backspace>"],
      checkpoints: [
        { at: 1, expect: "(|)" },
        { at: 2, expect: "|" },
      ],
    },
    {
      id: "skip-over-closing-bracket",
      label: "] inside [|] skips past, no duplicate",
      seed: "",
      events: ["[", "]"],
      checkpoints: [
        { at: 1, expect: "[|]" },
        { at: 2, expect: "[]|" },
      ],
    },
    {
      id: "skip-over-closing-paren",
      label: ") inside (|) skips past, no duplicate",
      seed: "",
      events: ["(", ")"],
      checkpoints: [
        { at: 1, expect: "(|)" },
        { at: 2, expect: "()|" },
      ],
    },
    {
      id: "natural-link-typing",
      label: "[a](b) types end-to-end with no stranded chars",
      seed: "",
      events: ["[", "a", "]", "(", "b", ")"],
      checkpoints: [
        { at: 3, expect: "[a]|" },
        // at 4: empty href `[a]()` is a valid link, fires immediately.
        { at: 4, expect: "<g>[</g><l:>a</l><g>](</g>|<g>)</g>" },
        { at: 6, expect: "<g>[</g><l:b>a</l><g>](b)</g>|" },
      ],
    },
    {
      id: "skip-over-only-when-match",
      label: "] before non-] inserts as-is",
      seed: "",
      events: ["a", "]"],
      checkpoints: [{ at: 2, expect: "a]|" }],
    },
    {
      id: "backspace-keeps-pair-when-content",
      label: "Backspace inside [x] only removes the [",
      seed: "",
      events: ["[", "x", "<ArrowLeft>", "<Backspace>"],
      checkpoints: [
        { at: 2, expect: "[x|]" },
        { at: 3, expect: "[|x]" },
        { at: 4, expect: "|x]" },
      ],
    },
  ],
};
