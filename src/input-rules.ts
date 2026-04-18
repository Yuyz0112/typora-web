import { inputRules } from "prosemirror-inputrules";
import { Plugin } from "prosemirror-state";

import { collectInputRules } from "./features/index.ts";
import { schema } from "./schema.ts";

export function markdownInputRules(): Plugin {
  return inputRules({ rules: collectInputRules(schema) });
}

// Space breaks out of storedMarks — matches Typora's UX: right after a mark
// is created, a space should land outside the mark. This does not affect
// typing a space inside an existing mark range (e.g. `*hello world*`),
// because then the space sits inside an existing text node and PM computes
// marks by position, bypassing storedMarks.
export function spaceBreaksStoredMarks(): Plugin {
  return new Plugin({
    props: {
      handleTextInput(view, from, to, text) {
        if (text !== " ") return false;
        const stored = view.state.storedMarks;
        if (!stored || stored.length === 0) return false;
        // Build the space text node directly with no marks. Using
        // tr.insertText would fall back to $from.marks() when storedMarks is
        // null/[], and an inclusive mark (em) would re-attach to the space.
        const spaceNode = view.state.schema.text(" ");
        const tr = view.state.tr.replaceWith(from, to, spaceNode).setStoredMarks(null);
        view.dispatch(tr);
        return true;
      },
    },
  });
}
