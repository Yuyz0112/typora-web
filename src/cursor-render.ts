// Render the selection as a decoration widget. Two uses:
//  1) In the harness, the real browser does not paint a native caret when the
//     view is not focused — this widget stands in.
//  2) In headless pretty, the PM view has no user caret at all — this widget
//     provides the visual anchor the pretty printer reads.
// When the real editor is focused, the CSS rule
// `.ProseMirror-focused .play-caret { display: none }` hides this widget so
// the native caret takes over. The two are mutually exclusive.
//
// Under method-B the gray delims are inline decorations on real text chars
// (not zero-width widgets), so the caret widget at a mark boundary already
// sits naturally before/after those chars — no dynamic `side` needed.

import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

export function cursorRenderPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const sel = state.selection;
        if (!sel.empty) {
          // Non-empty selection: a marker at each end, rendered as `[` / `]`.
          const open = makeWidget("selection-marker", "[");
          const close = makeWidget("selection-marker", "]");
          return DecorationSet.create(state.doc, [
            Decoration.widget(sel.from, open, { side: -1 }),
            Decoration.widget(sel.to, close, { side: 1 }),
          ]);
        }
        const el = makeWidget("play-caret", "");
        return DecorationSet.create(state.doc, [
          Decoration.widget(sel.from, el, { side: 0 }),
        ]);
      },
    },
  });
}

function makeWidget(cls: string, content: string): () => HTMLElement {
  return () => {
    const el = document.createElement("span");
    el.className = cls;
    if (content) el.textContent = content;
    return el;
  };
}
