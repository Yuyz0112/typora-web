// Render the selection as a decoration widget. Two uses:
//  1) In the harness, the real browser does not paint a native caret when the
//     view is not focused — this widget stands in.
//  2) In headless pretty, the PM view has no user caret at all — this widget
//     provides the visual anchor the pretty printer reads.
// When the real editor is focused, the CSS rule
// `.ProseMirror-focused .play-caret { display: none }` hides this widget so
// the native caret takes over. The two are mutually exclusive.
//
// `side` is chosen dynamically so the caret lines up with syntaxHints' gray
// delimiters under the rule "cursor on a mark boundary renders outside the
// mark":
//   caret at an existing gray-close `to` → side +2 (after the close)
//   caret at an existing gray-open `from` → side -2 (before the open)
//   otherwise → 0

import { Plugin } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import { deriveDecorations } from "./decorations.ts";

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
        const pos = sel.from;
        const spans = deriveDecorations(state);
        let side = 0;
        for (const s of spans) {
          if (s.to === pos) side = 2;
          else if (s.from === pos) side = -2;
        }
        const el = makeWidget("play-caret", "");
        return DecorationSet.create(state.doc, [
          Decoration.widget(pos, el, { side }),
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
