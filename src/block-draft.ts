// leaveLineDraft — reusable "type a prefix, cursor leaves, commit to a new
// block node" plugin. Three features share this shape: heading (`#` …),
// horizontal rule (`---`), fenced code (``` ```).
//
// While the cursor is in a paragraph whose textContent matches the feature's
// regex, the helper:
//
//   1. paints a node decoration on the paragraph (CSS class for
//      bold/indent/etc. while in draft)
//   2. optionally paints an inline decoration on the leading `prefixLen`
//      chars with class `syntax-hint` (gray `#` / ``` delim visible
//      only while in draft, same CSS used by inline marks)
//
// When the selection moves to a DIFFERENT paragraph (any reason — arrow
// keys, Enter splitting, mouse click, programmatic), the helper calls the
// feature's `commit` callback with a transaction whose `replaceWith` /
// `setBlockType` / whatever builds the real node. Typing inside the
// paragraph (even making it no longer match) does NOT commit — the commit
// trigger is "cursor exits this paragraph", not "match invalidated".
//
// A second, imperative commit path is exposed as `handle.commit(view)` —
// for triggers that aren't selection changes (fenced code's autocomplete
// dropdown click is the motivating case).

import type { Node as PMNode } from "prosemirror-model";
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

export type MatchResult<M> = { data: M; prefixLen: number };

export type LeaveLineDraftSpec<M> = {
  // Inspect a paragraph's textContent. Return { data, prefixLen } when it
  // matches the feature's draft pattern; null otherwise. `prefixLen` is
  // the leading char count that should show as gray (0 to skip the
  // syntax-hint inline decoration).
  match: (text: string) => MatchResult<M> | null;

  // CSS class applied to the draft paragraph as a Decoration.node. The
  // stylesheet decides what the class does (bold for heading, etc.).
  draftClass: (data: M) => string;

  // Build the commit transaction. `paragraphPos` is the position BEFORE
  // the paragraph node in newState.doc; `paragraph` is that node. Typical
  // implementation: `tr.replaceWith(pos, pos + paragraph.nodeSize, newNode)`.
  // Setting a selection on `tr` is allowed (fenced code places the caret
  // inside the new code block when Enter was the trigger).
  commit: (
    tr: Transaction,
    paragraphPos: number,
    paragraph: PMNode,
    data: M,
  ) => void;
};

export type LeaveLineDraftHandle = {
  plugin: Plugin<DecorationSet>;
  // Imperative commit — returns true if a commit was dispatched. Features
  // can call this from their own event handlers (autocomplete, toolbar).
  commit: (view: EditorView) => boolean;
};

export function leaveLineDraft<M>(spec: LeaveLineDraftSpec<M>): LeaveLineDraftHandle {
  const key = new PluginKey<DecorationSet>("leaveLineDraft");

  function matchForCursorParagraph(
    state: EditorState,
  ): { paragraph: PMNode; paragraphPos: number; paragraphStart: number; data: M; prefixLen: number } | null {
    const sel = state.selection;
    if (!sel.empty) return null;
    const $from = sel.$from;
    const paragraph = $from.parent;
    if (paragraph.type.name !== "paragraph") return null;
    const m = spec.match(paragraph.textContent);
    if (!m) return null;
    return {
      paragraph,
      paragraphPos: $from.before(),
      paragraphStart: $from.start(),
      data: m.data,
      prefixLen: m.prefixLen,
    };
  }

  function buildDecos(state: EditorState): DecorationSet {
    const hit = matchForCursorParagraph(state);
    if (!hit) return DecorationSet.empty;
    const { paragraph, paragraphPos, paragraphStart, data, prefixLen } = hit;
    const decos: Decoration[] = [
      Decoration.node(paragraphPos, paragraphPos + paragraph.nodeSize, {
        class: spec.draftClass(data),
      }),
    ];
    if (prefixLen > 0) {
      decos.push(
        Decoration.inline(paragraphStart, paragraphStart + prefixLen, {
          class: "syntax-hint",
        }),
      );
    }
    return DecorationSet.create(state.doc, decos);
  }

  const plugin = new Plugin<DecorationSet>({
    key,
    state: {
      init: (_, state) => buildDecos(state),
      apply: (_tr, _old, _oldState, newState) => buildDecos(newState),
    },
    props: {
      decorations(state) {
        return key.getState(state);
      },
    },
    appendTransaction(trs, oldState, newState) {
      // Trigger: oldState's cursor was in a matching paragraph, newState's
      // cursor is in a DIFFERENT paragraph (mapped-position compare).
      // Typing inside the same paragraph — even edits that break the match
      // — does not commit; only "leaving the line" does.
      const oldSel = oldState.selection;
      if (!oldSel.empty) return null;
      const oldPara = oldSel.$from.parent;
      if (oldPara.type.name !== "paragraph") return null;
      if (!spec.match(oldPara.textContent)) return null;

      const oldParaPos = oldSel.$from.before();
      let mapped = oldParaPos;
      for (const tr of trs) mapped = tr.mapping.map(mapped);

      const newSel = newState.selection;
      if (newSel.empty && newSel.$from.before() === mapped) return null;

      // Paragraph might have been deleted or replaced already — bail
      // rather than corrupt the doc.
      const paraNow = newState.doc.nodeAt(mapped);
      if (!paraNow || paraNow.type.name !== "paragraph") return null;
      // Recheck the match on the (possibly edited) paragraph. If the
      // leaving edit itself broke the pattern (e.g. user deleted the `#`
      // with a shortcut that also moved the cursor), skip.
      const reMatched = spec.match(paraNow.textContent);
      if (!reMatched) return null;

      const tr = newState.tr;
      spec.commit(tr, mapped, paraNow, reMatched.data);
      return tr.docChanged ? tr : null;
    },
  });

  const commit = (view: EditorView): boolean => {
    const hit = matchForCursorParagraph(view.state);
    if (!hit) return false;
    const tr = view.state.tr;
    spec.commit(tr, hit.paragraphPos, hit.paragraph, hit.data);
    if (!tr.docChanged) return false;
    view.dispatch(tr);
    return true;
  };

  return { plugin, commit };
}
