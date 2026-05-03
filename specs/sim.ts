// Headless simulator — wraps an EditorState in a `ViewLike` so the
// event DSL driver (`feedEvent`) can replay events without a live
// EditorView. Used by both the test runner (tests/utils.ts) and the
// website's case-card (precomputes per-checkpoint pass/fail at mount).

import type { EditorState, Transaction } from "prosemirror-state";
import type { ViewLike } from "./events.ts";

export function fakeView(
  state: EditorState,
): ViewLike & { state: EditorState } {
  const view = {
    state,
    dispatch(tr: Transaction) {
      view.state = view.state.apply(tr);
    },
    hasFocus: () => true,
    endOfTextblock(
      dir: "backward" | "forward" | "up" | "down",
      s?: EditorState,
    ): boolean {
      const st = s ?? view.state;
      const $c = (st.selection as { $cursor?: ReturnType<typeof st.doc.resolve> }).$cursor;
      if (!$c) return false;
      if (dir === "backward") return $c.parentOffset === 0;
      if (dir === "forward") return $c.parentOffset === $c.parent.content.size;
      return false;
    },
  };
  return view;
}
