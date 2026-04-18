// Cursor-aware syntax hints — Typora's signature visual: when the cursor sits
// inside a mark range, show the source delimiters (*, **, `, …) as a gray
// hint glued to each end of the mark.
//
// Two paths coexist while the Typora-pilot migration is underway:
//
//   1. WIDGET path (legacy, used by code/strike/link): the mark's doc text
//      does NOT contain the source delim chars. deriveDecorations finds the
//      mark boundary around the cursor, and a widget Decoration is mounted
//      at each end to render the gray delim.
//
//   2. INLINE path (method-B, used by em/strong): the mark's doc text DOES
//      contain the delim chars. The normalize plugin exposes their ranges;
//      here we wrap each delim range in an inline Decoration whose class
//      tells the stylesheet (and test-pretty) whether to display it gray
//      (cursor in the surrounding span) or hide it (cursor out of range).

import type { Mark, Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import { collectDecorationDelims, collectInlineFeatures } from "./features/index.ts";
import { getDelims } from "./normalize.ts";

// Mark names owned by the inline (method-B) path. Widget path skips these.
const inlinePathMarks = new Set(collectInlineFeatures().flatMap((f) => f.markNames));

// ─────────────────────────────────────────────────────────────────────────────
// Widget path — mark-boundary based.
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

const coreDelims: Record<string, { open: string; close: string }> = {
  link: { open: "[", close: "]" },
};

const DELIM: Record<string, { open: string; close: string }> = {
  ...coreDelims,
  ...collectDecorationDelims(),
};

function makeWidget(char: string): () => HTMLElement {
  return () => {
    const el = document.createElement("span");
    el.className = "syntax-hint";
    el.textContent = char;
    return el;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin
// ─────────────────────────────────────────────────────────────────────────────

function buildDecorationSet(state: EditorState): DecorationSet {
  const decos: Decoration[] = [];

  // Widget path — only for marks whose text does NOT contain the delim
  // chars (currently link). Any mark that an inline feature claims goes
  // through the inline path below instead.
  for (const s of deriveDecorations(state)) {
    const name = s.mark.type.name;
    if (inlinePathMarks.has(name)) continue;
    const d = DELIM[name];
    if (!d) continue;
    decos.push(Decoration.widget(s.from, makeWidget(d.open), { side: -1 }));
    decos.push(Decoration.widget(s.to, makeWidget(d.close), { side: 1 }));
  }

  // Inline path — em/strong delim chars live in text.
  const cursor = state.selection.empty ? state.selection.from : null;
  for (const d of getDelims(state)) {
    const visible = cursor !== null && cursor >= d.spanFrom && cursor <= d.spanTo;
    const cls = visible ? "syntax-hint" : "syntax-hidden";
    decos.push(Decoration.inline(d.from, d.to, { class: cls }));
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
