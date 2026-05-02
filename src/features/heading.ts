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

  cases: [
    {
      id: "type-and-commit-h1",
      label: "# a<Enter> — typing draft then commit to <h1>",
      seed: "",
      events: ["#", " ", "a", "<Enter>"],
      checkpoints: [
        // `#` alone: not entered (needs ` ` + content).
        { at: 1, expect: "#|" },
        // `# `: still not entered (pattern requires non-empty content).
        { at: 2, expect: "# |" },
        // `# a`: draft active — `# ` gets syntax-hint deco, content visible.
        { at: 3, expect: "<g># </g>a|" },
        // Enter commits the draft to a real heading; caret lands in a new
        // paragraph below.
        { at: 4, expect: "<h1>a</h1>\n|" },
      ],
    },

    {
      id: "type-and-commit-h3",
      label: "### x<Enter> — level N picked from #-count",
      seed: "",
      events: ["#", "#", "#", " ", "x", "<Enter>"],
      checkpoints: [
        { at: 3, expect: "###|" },          // not entered
        { at: 4, expect: "### |" },         // still not entered (empty content)
        { at: 5, expect: "<g>### </g>x|" }, // draft
        { at: 6, expect: "<h3>x</h3>\n|" }, // commit
      ],
    },

    {
      id: "hash-space-enter-stays-paragraph",
      label: "# <Enter> — never entered draft, Enter does not commit",
      seed: "",
      events: ["#", " ", "<Enter>"],
      checkpoints: [
        { at: 2, expect: "# |" },
        // Enter on a "not entered" paragraph splits normally: two
        // paragraphs, caret at start of the second.
        { at: 3, expect: "# \n|" },
      ],
    },

    {
      id: "backspace-exits-draft",
      label: "# a + two Backspaces — draft exits, then `#` removed",
      seed: "",
      events: ["#", " ", "a", "<Backspace>", "<Backspace>"],
      checkpoints: [
        { at: 3, expect: "<g># </g>a|" },   // draft
        // Delete `a` → text is `# ` → pattern fails → draft exits → plain paragraph.
        { at: 4, expect: "# |" },
        // Delete the space → text is `#` → still paragraph, no deco.
        { at: 5, expect: "#|" },
      ],
    },

    {
      id: "rendered-seed-has-cursor-at-end",
      label: "seed `# a` parses to <h1>; cursor lands at end",
      seed: "# a",
      events: [],
      checkpoints: [
        // Parser produces a committed heading; setup() puts the caret at
        // end-of-doc, which resolves to inside the heading.
        { at: 0, expect: "<h1>a|</h1>" },
      ],
    },

    {
      id: "commit-then-type",
      label: "# a<Enter>x — caret is in new paragraph after commit",
      seed: "",
      events: ["#", " ", "a", "<Enter>", "x"],
      checkpoints: [
        { at: 3, expect: "<g># </g>a|" },
        { at: 4, expect: "<h1>a</h1>\n|" },
        { at: 5, expect: "<h1>a</h1>\nx|" },
      ],
    },

    {
      id: "arrow-leave-commits",
      label: "ArrowDown from draft commits to heading (heading-scoped plugin)",
      // headingArrowDownPlugin fires only inside a heading-draft paragraph
      // at the doc's absolute end: spawns a fresh trailing paragraph, moves
      // the cursor into it, and leaveLineDraft then runs its commit. This
      // is NOT a global "last-line ArrowDown" behavior — a plain paragraph
      // at doc end does nothing.
      seed: "",
      events: ["#", " ", "a", "<ArrowDown>"],
      checkpoints: [
        { at: 3, expect: "<g># </g>a|" },
        { at: 4, expect: "<h1>a</h1>\n|" },
      ],
    },

    // ─── setext ───────────────────────────────────────────────────────
    // Typora doesn't auto-convert paragraph + `===` on Enter (we tested
    // and confirmed). setext is an *input* format only: parser recognises
    // it, serializer preserves it via the `style` attr. Pretty doesn't
    // distinguish atx/setext — both render <h1>x</h1> — so attr survival
    // is verified by roundtrip.test.ts (`doc1.eq(doc2)` checks attrs).
    {
      id: "parse-setext-h1",
      label: "seed `Heading\\n===` parses to <h1>",
      seed: "Heading\n===",
      events: [],
      checkpoints: [
        { at: 0, expect: "<h1>Heading|</h1>" },
      ],
    },
    {
      id: "parse-setext-h2",
      label: "seed `Heading\\n---` parses to <h2> (not hr, since preceding text)",
      seed: "Heading\n---",
      events: [],
      checkpoints: [
        { at: 0, expect: "<h2>Heading|</h2>" },
      ],
    },
    {
      id: "edit-setext-keeps-shape",
      label: "typing into a setext h1 keeps it heading",
      seed: "Heading\n===",
      events: ["x"],
      checkpoints: [
        { at: 0, expect: "<h1>Heading|</h1>" },
        { at: 1, expect: "<h1>Headingx|</h1>" },
      ],
    },

    // Two previously SKIPPED cases are removed because `runFeatureCases`
    // can't describe-without-tests cleanly:
    //   - rendered-reentry-stays-rendered (needs seed → rendered heading
    //     AND ArrowUp from a following paragraph into the heading)
    //   - empty-heading-double-backspace (needs a seed path to an empty
    //     heading; parser drops `# ` to a paragraph)
    // Reactivate once test-utils grows a JSON-seed path.
  ],
};
