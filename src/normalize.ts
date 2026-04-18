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
};

export type NormalizeState = { delims: DelimRange[] };

type BlockPlan = { blockStart: number; spans: InlineSpan[] };

// Walk the doc, return per-textblock parse plan + absolute-pos delim list.
function computePlan(doc: PMNode): {
  blocks: Array<{ blockPos: number; plan: BlockPlan }>;
  delims: DelimRange[];
} {
  const blocks: Array<{ blockPos: number; plan: BlockPlan }> = [];
  const delims: DelimRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const text = node.textContent;
    const spans = parseInline(text);
    const blockStart = pos + 1;
    blocks.push({ blockPos: pos, plan: { blockStart, spans } });
    for (const s of spans) {
      const spanFrom = blockStart + s.openFrom;
      const spanTo = blockStart + s.closeTo;
      delims.push({ from: blockStart + s.openFrom, to: blockStart + s.openTo, spanFrom, spanTo });
      delims.push({ from: blockStart + s.closeFrom, to: blockStart + s.closeTo, spanFrom, spanTo });
    }
    return false; // don't descend into inline children
  });
  return { blocks, delims };
}

const normalizeKey = new PluginKey<NormalizeState>("normalize-inline");

export function normalizeInlinePlugin(): Plugin<NormalizeState> {
  return new Plugin<NormalizeState>({
    key: normalizeKey,

    state: {
      init: (_, state) => ({ delims: computePlan(state.doc).delims }),
      apply: (_tr, _prev, _oldState, newState) => ({ delims: computePlan(newState.doc).delims }),
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

          const target = new Uint8Array(size);
          for (const s of spans) {
            if (s.type !== name) continue;
            for (let i = s.from; i < s.to; i++) target[i] = 1;
          }

          const current = new Uint8Array(size);
          let off = 0;
          blockNode.content.forEach((child) => {
            const has = child.marks.some((m) => m.type === markType);
            if (has) for (let i = 0; i < child.nodeSize; i++) current[off + i] = 1;
            off += child.nodeSize;
          });

          if (arraysEqual(target, current)) continue;

          tr.removeMark(blockStart, blockEnd, markType);
          for (const s of spans) {
            if (s.type === name)
              tr.addMark(blockStart + s.from, blockStart + s.to, markType.create());
          }
          changed = true;
        }
      }

      return changed ? tr : null;
    },
  });
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function getDelims(state: EditorState): DelimRange[] {
  return normalizeKey.getState(state)?.delims ?? [];
}
