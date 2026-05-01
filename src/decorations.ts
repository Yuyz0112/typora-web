// Cursor-aware syntax hints — Typora's signature visual: when the cursor sits
// inside a mark range, show the source delimiters (*, **, `, ~~, [, ]) as a
// gray hint; when it leaves, hide them.
//
// Every inline feature (em/strong/code/strike/link) follows method-B: the
// delim chars live in the textblock text and `normalize` derives the marks.
// This plugin just reads normalize's delim ranges and wraps each in an
// inline Decoration whose class tells the stylesheet (and test-pretty)
// whether to show it gray (cursor inside the surrounding span) or hide it
// (cursor outside).

import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import { getDelims, getExtras } from "./normalize.ts";

function buildDecorationSet(state: EditorState): DecorationSet {
  const decos: Decoration[] = [];
  const cursor = state.selection.empty ? state.selection.from : null;
  for (const d of getDelims(state)) {
    const cursorInside =
      cursor !== null && cursor >= d.spanFrom && cursor <= d.spanTo;
    if (d.softInside) {
      // Soft range: hidden when cursor outside, plain (no decoration)
      // when cursor inside so the chars render as ordinary text.
      if (!cursorInside) {
        decos.push(Decoration.inline(d.from, d.to, { class: "syntax-hidden" }));
      }
      continue;
    }
    const visible = d.forceVisible || cursorInside;
    const cls = visible ? "syntax-hint" : "syntax-hidden";
    decos.push(Decoration.inline(d.from, d.to, { class: cls }));
  }
  for (const ex of getExtras(state)) {
    decos.push(
      Decoration.inline(ex.from, ex.to, { nodeName: ex.nodeName, ...(ex.attrs ?? {}) }),
    );
  }
  return decos.length > 0 ? DecorationSet.create(state.doc, decos) : DecorationSet.empty;
}

const syntaxHintsKey = new PluginKey<DecorationSet>("syntaxHints");

export function syntaxHintsPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: syntaxHintsKey,
    state: {
      init: (_, state) => buildDecorationSet(state),
      apply: (_tr, _old, _oldState, newState) => buildDecorationSet(newState),
    },
    props: {
      decorations(state) {
        return syntaxHintsKey.getState(state);
      },
    },
  });
}
