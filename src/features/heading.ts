import type { Schema } from "prosemirror-model";
import { Plugin, Selection, TextSelection } from "prosemirror-state";

import { leaveLineDraft } from "../block-draft.ts";
import type { FeatureSpec } from "./_types.ts";

// Heading (Typora-style draft → commit).
//
// While the cursor sits in a paragraph whose textContent matches
// `^(#{1,6}) (.+)$`, the helper decorates the leading `#{N} ` with
// `syntax-hint` (gray in pretty: `<g># </g>`) and tags the paragraph
// with `heading-draft-{N}` via a node decoration (CSS bolds it — test
// assertions don't depend on CSS).
//
// When the cursor leaves the line (Enter splitBlock, ArrowUp/Down,
// click), the paragraph is replaced with a real `heading` node of
// level N. The commit is one-way: re-entering a rendered heading does
// NOT go back to draft. That comes for free because `leaveLineDraft`
// only matches paragraphs — a heading node never triggers draft state.
//
// Extra: Backspace at the start of an empty heading unwraps to
// paragraph. PM's default joinBackward would merge into the previous
// block; we want the "unwrap in place" semantics Typora uses.

const HEADING_RE = /^(#{1,6}) (.+)$/;

// Typora-specific UX: ArrowDown inside a HEADING DRAFT line, at the very
// end of the doc, spawns a fresh empty paragraph below and moves the
// cursor into it. This gives the draft a place to leave to, which makes
// leaveLineDraft fire its commit. Scoped to heading drafts only — regular
// paragraphs at end-of-doc do NOT auto-extend (that was a broader plugin
// I pulled out of core once I learned it was heading-specific behavior).
function headingArrowDownPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, e) {
        if (e.key !== "ArrowDown") return false;
        if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
        const { state } = view;
        const sel = state.selection;
        if (!sel.empty) return false;
        const para = sel.$from.parent;
        if (para.type.name !== "paragraph") return false;
        if (!HEADING_RE.test(para.textContent)) return false;
        // Only at doc's absolute end — ArrowDown inside a heading draft
        // that has a following block should just move into that block.
        const end = Selection.atEnd(state.doc);
        if (sel.from !== end.from) return false;
        const paraType = state.schema.nodes.paragraph;
        if (!paraType) return false;
        const newPara = paraType.createAndFill();
        if (!newPara) return false;
        const insertPos = state.doc.content.size;
        const tr = state.tr.insert(insertPos, newPara);
        tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
        view.dispatch(tr);
        return true;
      },
    },
  });
}

function makeHeadingPlugin(schema: Schema) {
  return leaveLineDraft<{ level: number }>({
    match: (text) => {
      const m = HEADING_RE.exec(text);
      if (!m) return null;
      const level = m[1]!.length;
      return {
        data: { level },
        prefixLen: level + 1, // `#{N} ` — N hashes plus one space.
      };
    },
    draftClass: (data) => `heading-draft-${data.level}`,
    commit: (tr, pos, paragraph, data) => {
      // Drop the `#{N} ` prefix and re-wrap the remaining inline
      // content in a heading. Fragment.cut(N+1) keeps position offsets
      // aligned with text offsets (marks attach to text nodes, not
      // positions) so marks on the remaining content survive.
      const prefix = data.level + 1;
      const remaining = paragraph.content.cut(prefix);
      const headingNode = schema.nodes.heading.create(
        { level: data.level },
        remaining,
      );
      tr.replaceWith(pos, pos + paragraph.nodeSize, headingNode);
    },
  });
}

export const heading: FeatureSpec = {
  name: "heading",

  plugins: (schema) => [makeHeadingPlugin(schema).plugin, headingArrowDownPlugin()],

  keymap: (schema) => ({
    // Empty heading + Backspace at start → unwrap to paragraph.
    // PM's baseKeymap Backspace (joinBackward) would merge into the
    // previous block — we want the heading-in-place to become a
    // plain paragraph. Only fires on an empty heading at offset 0.
    Backspace: (state, dispatch) => {
      const sel = state.selection;
      if (!sel.empty) return false;
      const $from = sel.$from;
      if ($from.parent.type.name !== "heading") return false;
      if ($from.parentOffset !== 0) return false;
      if ($from.parent.content.size > 0) return false;
      if (dispatch) {
        const tr = state.tr;
        const pos = $from.before();
        tr.setBlockType(pos, pos + $from.parent.nodeSize, schema.nodes.paragraph);
        dispatch(tr);
      }
      return true;
    },
  }),

};
