import { EditorState, TextSelection, type Transaction } from "prosemirror-state";

import { createState } from "./editor.ts";
import { type Event, feedEvent, type ViewLike } from "./events.ts";
import { parse } from "./parser.ts";
import { schema } from "./schema.ts";

export { pretty } from "./test-pretty.ts";
export type { Event } from "./events.ts";

// fakeView for headless tests — wires plugin dispatches back into state.apply
function fakeView(state: EditorState): ViewLike & { state: EditorState } {
  const view = {
    state,
    dispatch(tr: Transaction) {
      view.state = view.state.apply(tr);
    },
    hasFocus: () => true,
    endOfTextblock(dir: "backward" | "forward" | "up" | "down", s?: EditorState): boolean {
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

export function setup(md = ""): EditorState {
  const doc = md ? parse(md) : schema.nodes.doc.createAndFill()!;
  const base = createState(doc);
  return base.apply(base.tr.setSelection(TextSelection.atEnd(doc)));
}

export function apply(state: EditorState, events: Event[]): EditorState {
  const view = fakeView(state);
  for (const e of events) feedEvent(view, e);
  return view.state;
}
