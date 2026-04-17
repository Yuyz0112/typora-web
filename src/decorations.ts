// Cursor-aware syntax hints — Typora's signature visual: when the cursor sits
// inside a mark range, show the source delimiters (*, **, `, …) as a gray
// hint glued to each end of the mark.
//
// This module exposes both a pure `deriveDecorations(state)` (consumed by the
// test pretty printer) and a `syntaxHintsPlugin()` (mounts a DecorationSet on
// a real EditorView). A single rule, two consumers.

import type { Mark, Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

// ─────────────────────────────────────────────────────────────────────────────
// Pure: which mark ranges should display a gray source delimiter hint.
// ─────────────────────────────────────────────────────────────────────────────

export type DecoSpan = { from: number; to: number; mark: Mark };

export function deriveDecorations(state: EditorState): DecoSpan[] {
  const sel = state.selection;
  if (!sel.empty) return [];
  const $c = state.doc.resolve(sel.from);
  const active = state.storedMarks ?? $c.marks();
  if (active.length === 0) return [];

  const parent = $c.parent;
  if (!parent.isTextblock) return [];
  const blockStart = $c.start();
  const offset = $c.parentOffset;

  const spans: DecoSpan[] = [];
  for (const mark of active) {
    const [fromOff, toOff] = expandMarkRange(parent, offset, mark);
    if (fromOff === toOff) continue;
    spans.push({ from: blockStart + fromOff, to: blockStart + toOff, mark });
  }
  return spans;
}

function expandMarkRange(parent: PMNode, offset: number, mark: Mark): [number, number] {
  let pos = 0;
  const segs: Array<{ start: number; end: number; has: boolean }> = [];
  parent.forEach((child) => {
    const has = child.marks.some((m) => m.eq(mark));
    segs.push({ start: pos, end: pos + child.nodeSize, has });
    pos += child.nodeSize;
  });
  let idx = segs.findIndex((s) => offset > s.start && offset <= s.end && s.has);
  if (idx < 0) idx = segs.findIndex((s) => offset >= s.start && offset <= s.end && s.has);
  if (idx < 0) return [offset, offset];
  let lo = idx;
  while (lo > 0 && segs[lo - 1]!.has) lo--;
  let hi = idx;
  while (hi < segs.length - 1 && segs[hi + 1]!.has) hi++;
  return [segs[lo]!.start, segs[hi]!.end];
}

// ─────────────────────────────────────────────────────────────────────────────
// Source-delimiter text for each mark type.
// ─────────────────────────────────────────────────────────────────────────────

const DELIM: Record<string, { open: string; close: string }> = {
  em: { open: "*", close: "*" },
  strong: { open: "**", close: "**" },
  code: { open: "`", close: "`" },
  link: { open: "[", close: "]" },
};

// ─────────────────────────────────────────────────────────────────────────────
// PM plugin: render the source delimiters into the real view as widget decos.
// ─────────────────────────────────────────────────────────────────────────────

function makeWidget(char: string): (view: unknown, getPos: () => number | undefined) => HTMLElement {
  return () => {
    const el = document.createElement("span");
    el.className = "syntax-hint";
    el.textContent = char;
    return el;
  };
}

function buildDecorationSet(state: EditorState): DecorationSet {
  const spans = deriveDecorations(state);
  if (spans.length === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  for (const s of spans) {
    const d = DELIM[s.mark.type.name];
    if (!d) continue;
    // `side` positions the widget relative to other widgets at the same PM pos:
    // gray open at -1 sits before any inner content; gray close at +1 sits after.
    decos.push(Decoration.widget(s.from, makeWidget(d.open), { side: -1 }));
    decos.push(Decoration.widget(s.to, makeWidget(d.close), { side: 1 }));
  }
  return DecorationSet.create(state.doc, decos);
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
