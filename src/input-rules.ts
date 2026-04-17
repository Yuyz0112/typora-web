import { InputRule, inputRules } from "prosemirror-inputrules";
import { Plugin } from "prosemirror-state";

import { schema } from "./schema.ts";

// `*text*` → em mark on "text".
// - Negative lookbehind `(?<!\*)` keeps this rule from chewing into `**bold**`
//   when a strong rule is added later.
// - No whitespace allowed immediately inside the asterisks, so `* foo*` and
//   `*foo *` do not trigger.
const EM_PATTERN = /(?<!\*)\*([^*\s](?:[^*]*[^*\s])?)\*$/;

const emRule = new InputRule(EM_PATTERN, (state, match, start, end) => {
  const captured = match[1]!;
  const em = schema.marks.em.create();
  const tr = state.tr
    .delete(start, end)
    .insert(start, schema.text(captured, [em]));
  // Put em in storedMarks so the cursor is visually "inside the mark" —
  // this is what the decoration layer uses to render the gray delimiters.
  tr.setStoredMarks([em]);
  return tr;
});

export function markdownInputRules(): Plugin {
  return inputRules({ rules: [emRule] });
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
