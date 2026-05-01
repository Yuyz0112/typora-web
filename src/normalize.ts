// Normalize plugin — the authoritative "text → marks" step.
//
// After every transaction, walk each textblock, run parseInline on its
// textContent, and reconcile em/strong marks to match. Delim ranges are
// exposed via plugin state so the decorations plugin can render them as
// syntax-hint / syntax-hidden.

import type { Node as PMNode } from "prosemirror-model";
import { Plugin, PluginKey, type EditorState } from "prosemirror-state";

import { collectInlineFeatures } from "./features/index.ts";
import { parseInline, type InlineSpan } from "./inline-parse.ts";
import { schema } from "./schema.ts";

export type DelimRange = {
  from: number;
  to: number;
  // The surrounding mark's full source range (open start .. close end).
  // Used by decoration/display to decide whether the cursor is "inside".
  spanFrom: number;
  spanTo: number;
  // When true, decorations renders this delim as `syntax-hint` regardless
  // of cursor position. Used for links whose visible content is empty —
  // hiding the delim would make the link disappear entirely.
  forceVisible?: boolean;
  // When true, the range is hidden when the cursor is outside the span
  // and rendered as plain text (no decoration) when the cursor is inside.
  // Used for soft whitespace ranges inside a code fence.
  softInside?: boolean;
};

export type ExtraDecoration = {
  from: number;
  to: number;
  nodeName: string;
  attrs?: Record<string, string>;
};

export type WidgetDecoration = {
  pos: number;
  spanFrom: number;
  spanTo: number;
  when: "inside" | "outside" | "always";
  kind: string;
  attrs?: Record<string, string>;
  side?: number;
};

export type NormalizeState = {
  delims: DelimRange[];
  extras: ExtraDecoration[];
  widgets: WidgetDecoration[];
};

type BlockPlan = { blockStart: number; spans: InlineSpan[] };

// Walk the doc, return per-textblock parse plan + absolute-pos delim list.
function computePlan(doc: PMNode): {
  blocks: Array<{ blockPos: number; plan: BlockPlan }>;
  delims: DelimRange[];
  extras: ExtraDecoration[];
  widgets: WidgetDecoration[];
} {
  const blocks: Array<{ blockPos: number; plan: BlockPlan }> = [];
  const delims: DelimRange[] = [];
  const extras: ExtraDecoration[] = [];
  const widgets: WidgetDecoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textContent;
    const spans = parseInline(text);
    const blockStart = pos + 1;
    blocks.push({ blockPos: pos, plan: { blockStart, spans } });
    for (const s of spans) {
      const spanFrom = blockStart + s.openFrom;
      const spanTo = blockStart + s.closeTo;
      if (s.delimRanges) {
        for (const dr of s.delimRanges) {
          delims.push({
            from: blockStart + dr.from,
            to: blockStart + dr.to,
            spanFrom,
            spanTo,
            forceVisible: dr.forceVisible,
            softInside: dr.softInside,
          });
        }
      } else {
        delims.push({ from: blockStart + s.openFrom, to: blockStart + s.openTo, spanFrom, spanTo });
        delims.push({ from: blockStart + s.closeFrom, to: blockStart + s.closeTo, spanFrom, spanTo });
      }
      if (s.extraDecorations) {
        for (const ex of s.extraDecorations) {
          extras.push({
            from: blockStart + ex.from,
            to: blockStart + ex.to,
            nodeName: ex.nodeName,
            attrs: ex.attrs,
          });
        }
      }
      if (s.widgetDecorations) {
        for (const w of s.widgetDecorations) {
          widgets.push({
            pos: blockStart + w.pos,
            spanFrom,
            spanTo,
            when: w.when,
            kind: w.kind,
            attrs: w.attrs,
            side: w.side,
          });
        }
      }
    }
    return false; // don't descend into inline children
  });
  return { blocks, delims, extras, widgets };
}

const normalizeKey = new PluginKey<NormalizeState>("normalize-inline");

export function normalizeInlinePlugin(): Plugin<NormalizeState> {
  return new Plugin<NormalizeState>({
    key: normalizeKey,

    state: {
      init: (_, state) => {
        const p = computePlan(state.doc);
        return { delims: p.delims, extras: p.extras, widgets: p.widgets };
      },
      apply: (_tr, _prev, _oldState, newState) => {
        const p = computePlan(newState.doc);
        return { delims: p.delims, extras: p.extras, widgets: p.widgets };
      },
    },

    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((t) => t.docChanged)) return null;
      const { blocks } = computePlan(newState.doc);
      const tr = newState.tr;
      const managedNames = collectInlineFeatures().flatMap((f) => f.markNames);
      let changed = false;

      for (const { blockPos, plan } of blocks) {
        const blockNode = newState.doc.nodeAt(blockPos);
        if (!blockNode || !blockNode.isTextblock) continue;
        const { blockStart, spans } = plan;
        const blockEnd = blockStart + blockNode.content.size;
        const size = blockNode.content.size;

        // For each managed mark type, compute target vs current; diff; apply.
        for (const name of managedNames) {
          const markType = schema.marks[name];
          if (!markType) continue;

          // For attr-bearing marks (link, image) coverage equality isn't
          // enough — attrs (href / src / title) can change while coverage
          // stays the same. Build a per-position mark map and compare with
          // mark.eq() so we don't keep re-emitting identical removeMark+
          // addMark steps every transaction (PM would re-fire
          // appendTransaction on those steps and we'd loop).
          const targetMarks = new Array<import("prosemirror-model").Mark | null>(
            size,
          ).fill(null);
          for (const s of spans) {
            if (s.type !== name) continue;
            const m = markType.create(s.attrs);
            for (let i = s.from; i < s.to; i++) targetMarks[i] = m;
          }
          const currentMarks = new Array<import("prosemirror-model").Mark | null>(
            size,
          ).fill(null);
          {
            let cOff = 0;
            blockNode.content.forEach((child) => {
              const m = child.marks.find((mk) => mk.type === markType) ?? null;
              for (let i = 0; i < child.nodeSize; i++) currentMarks[cOff + i] = m;
              cOff += child.nodeSize;
            });
          }
          let same = true;
          for (let i = 0; i < size; i++) {
            const a = targetMarks[i];
            const b = currentMarks[i];
            if (a === b) continue;
            if (!a || !b || !a.eq(b)) {
              same = false;
              break;
            }
          }
          if (same) continue;

          tr.removeMark(blockStart, blockEnd, markType);
          for (const s of spans) {
            if (s.type === name)
              tr.addMark(blockStart + s.from, blockStart + s.to, markType.create(s.attrs));
          }
          changed = true;
        }
      }

      return changed ? tr : null;
    },
  });
}

export function getDelims(state: EditorState): DelimRange[] {
  return normalizeKey.getState(state)?.delims ?? [];
}

export function getExtras(state: EditorState): ExtraDecoration[] {
  return normalizeKey.getState(state)?.extras ?? [];
}

export function getWidgets(state: EditorState): WidgetDecoration[] {
  return normalizeKey.getState(state)?.widgets ?? [];
}
