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
  // When true, the range is hidden regardless of cursor — used for atomic
  // markers like task-list `[ ] ` whose source is not user-editable.
  forceHidden?: boolean;
  // Override the default decoration class.
  className?: string;
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
  // Cached for appendTransaction's mark-sync pass — avoids walking the
  // whole doc twice per transaction. Populated by state.apply / init.
  blocks: Array<{ blockPos: number; plan: BlockPlan }>;
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
  doc.descendants((node, pos, parent) => {
    if (!node.isTextblock) return true;
    const text = node.textContent;
    const spans = parseInline(text, parent);
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
            forceHidden: dr.forceHidden,
            className: dr.className,
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
      init: (_, state) => computePlan(state.doc),
      apply: (tr, prev, _oldState, newState) =>
        // Skip the doc walk when nothing in the doc changed — selection-
        // only transactions are very common (every keystroke that moves
        // the cursor) and the cached plan stays valid for them.
        tr.docChanged ? computePlan(newState.doc) : prev,
    },

    appendTransaction(_transactions, _oldState, newState) {
      // Reuse the plan computed in state.apply rather than walking the
      // doc a second time. (Caching cut a 50-blocks doc's per-tx
      // overhead roughly in half.)
      const planState = normalizeKey.getState(newState);
      if (!planState) return null;
      const { blocks } = planState;
      const tr = newState.tr;
      const managedNames = collectInlineFeatures().flatMap((f) => f.markNames);
      const managedTypes = managedNames
        .map((n) => schema.marks[n])
        .filter((t): t is NonNullable<typeof t> => !!t);
      let changed = false;

      for (const { blockPos, plan } of blocks) {
        const blockNode = newState.doc.nodeAt(blockPos);
        if (!blockNode || !blockNode.isTextblock) continue;
        const { blockStart, spans } = plan;
        const blockEnd = blockStart + blockNode.content.size;
        const size = blockNode.content.size;

        // Fast skip: if this block has no spans for ANY managed type AND
        // no existing managed marks on its text, there's nothing to
        // reconcile — the most common case for plain prose paragraphs.
        if (spans.length === 0) {
          let hasManaged = false;
          blockNode.content.forEach((child) => {
            for (const mk of child.marks)
              if (managedTypes.includes(mk.type)) { hasManaged = true; return; }
          });
          if (!hasManaged) continue;
        }

        for (const markType of managedTypes) {
          const name = markType.name;

          // Per-name fast skip: if no span of this type AND no existing
          // mark of this type on the block, nothing to do.
          let spansOfType = false;
          for (const s of spans) if (s.type === name) { spansOfType = true; break; }
          let hasMarkOfType = false;
          if (!spansOfType) {
            blockNode.content.forEach((child) => {
              if (hasMarkOfType) return;
              if (child.marks.some((mk) => mk.type === markType)) hasMarkOfType = true;
            });
            if (!hasMarkOfType) continue;
          }

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
