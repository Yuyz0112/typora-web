// Event driver — shared between the test runner and the playback harness in main.
// Translates the Event DSL into PM transactions and dispatches them to anything
// view-like (a real EditorView or the test fakeView).

import type { EditorState, Transaction } from "prosemirror-state";
import { Selection, TextSelection } from "prosemirror-state";

export type Event = string;

// Minimal view surface we rely on. A real EditorView already implements all of
// these, and the test fakeView emulates them.
export type ViewLike = {
  state: EditorState;
  dispatch(tr: Transaction): void;
  hasFocus(): boolean;
  endOfTextblock(
    dir: "backward" | "forward" | "up" | "down",
    state?: EditorState,
  ): boolean;
};

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function isSpecial(e: string): boolean {
  return e.length >= 3 && e.startsWith("<") && e.endsWith(">");
}

function parseSpecial(e: string): { key: string; mods: Set<string> } {
  const inner = e.slice(1, -1);
  const parts = inner.split("-");
  const key = parts.pop()!;
  return { key, mods: new Set(parts) };
}

function buildKeyEvent(spec: string): KeyboardEvent {
  const { key, mods } = parseSpecial(spec);
  const isMod = mods.has("Mod");
  return {
    key: key.length === 1 ? key.toLowerCase() : key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    ctrlKey: mods.has("Ctrl") || (isMod && !isMac),
    metaKey: mods.has("Meta") || (isMod && isMac),
    shiftKey: mods.has("Shift"),
    altKey: mods.has("Alt"),
    preventDefault() {},
    stopPropagation() {},
  } as unknown as KeyboardEvent;
}

export function feedText(view: ViewLike, text: string): void {
  const { from, to } = view.state.selection;
  const deflt = (): Transaction => view.state.tr.insertText(text, from, to);
  for (const plugin of view.state.plugins) {
    const handler = plugin.props.handleTextInput;
    if (handler?.call(plugin, view as never, from, to, text, deflt)) return;
  }
  view.dispatch(deflt());
}

export function feedKey(view: ViewLike, spec: string): void {
  const event = buildKeyEvent(spec);
  for (const plugin of view.state.plugins) {
    const handler = plugin.props.handleKeyDown;
    if (handler?.call(plugin, view as never, event)) return;
  }
  fallbackSelectionKey(view, spec);
}

function fallbackSelectionKey(view: ViewLike, spec: string): void {
  const { key, mods } = parseSpecial(spec);
  if (mods.size > 0) return;
  const state = view.state;
  const sel = state.selection;
  const doc = state.doc;
  switch (key) {
    case "ArrowLeft":
      view.dispatch(
        state.tr.setSelection(TextSelection.create(doc, Math.max(0, sel.from - 1))),
      );
      return;
    case "ArrowRight":
      view.dispatch(
        state.tr.setSelection(
          TextSelection.create(doc, Math.min(doc.content.size, sel.to + 1)),
        ),
      );
      return;
    case "ArrowDown": {
      // Move to the first selectable position after the current textblock
      // ends. Good enough for tests — we do NOT try to preserve the
      // column, which a real browser does. Atomic nodes (hr) are picked
      // up as NodeSelection via Selection.findFrom's `textOnly=false`.
      const $here = doc.resolve(sel.from);
      const startAt = Math.min(doc.content.size, $here.end($here.depth) + 1);
      const next = Selection.findFrom(doc.resolve(startAt), 1, true);
      if (next) view.dispatch(state.tr.setSelection(next));
      return;
    }
    case "ArrowUp": {
      const $here = doc.resolve(sel.from);
      const startAt = Math.max(0, $here.start($here.depth) - 1);
      const prev = Selection.findFrom(doc.resolve(startAt), -1, true);
      if (prev) view.dispatch(state.tr.setSelection(prev));
      return;
    }
    case "Home": {
      const $c = doc.resolve(sel.from);
      view.dispatch(state.tr.setSelection(TextSelection.create(doc, $c.start($c.depth))));
      return;
    }
    case "End": {
      const $c = doc.resolve(sel.from);
      view.dispatch(state.tr.setSelection(TextSelection.create(doc, $c.end($c.depth))));
      return;
    }
    case "Backspace": {
      if (!sel.empty) {
        view.dispatch(state.tr.deleteSelection());
        return;
      }
      const $c = doc.resolve(sel.from);
      if ($c.parentOffset === 0) return;
      view.dispatch(state.tr.delete(sel.from - 1, sel.from));
      return;
    }
    case "Delete": {
      if (!sel.empty) {
        view.dispatch(state.tr.deleteSelection());
        return;
      }
      const $c = doc.resolve(sel.from);
      if ($c.parentOffset === $c.parent.content.size) return;
      view.dispatch(state.tr.delete(sel.from, sel.from + 1));
      return;
    }
  }
}

export function feedEvent(view: ViewLike, e: Event): void {
  if (isSpecial(e)) feedKey(view, e);
  else if (e.length === 1) feedText(view, e);
  else for (const ch of e) feedText(view, ch);
}
