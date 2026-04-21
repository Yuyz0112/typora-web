import type { Schema } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";

import { leaveLineDraft } from "../block-draft.ts";
import type { FeatureSpec } from "./_types.ts";

// Fenced code block feature.
//
// Draft pattern: ^```(\w*)$ — while the cursor is in a paragraph whose
// textContent matches, the leading three backticks render gray via
// `syntax-hint` (prefixLen = 3). Any trailing word-chars are the lang
// being typed and render as normal text.
//
// Commit has TWO paths with different cursor outcomes:
//
//   1. Enter (feature-local keymap, runs before baseKeymap)
//      paragraph → code_block(lang), cursor lands INSIDE the new block.
//
//   2. Arrow / click / other leave-line (handled by `leaveLineDraft`
//      appendTransaction — observes old/new selection and runs commit)
//      paragraph → code_block(lang), cursor already mapped OUTSIDE
//      the block by PM's selection update.
//
// Out of scope for this round (tracked as TODOs for follow-up work):
//   - lang-input NodeView overlay (harness-only visual affordance)
//   - autocomplete dropdown for lang values
//   - vertical key navigation between a lang input and the code body
//   - empty code_block double-Backspace collapse-to-paragraph

const FENCE_RE = /^```(\w*)$/;

function makeFencedPlugin(schema: Schema) {
  return leaveLineDraft<{ lang: string }>({
    match: (text) => {
      const m = FENCE_RE.exec(text);
      if (!m) return null;
      // prefixLen stays 3 regardless of trailing \w* — the three
      // backticks are the delim, the lang chars are content.
      return { data: { lang: m[1] ?? "" }, prefixLen: 3 };
    },
    draftClass: () => "fenced-code-draft",
    commit: (tr, pos, paragraph, data) => {
      // Arrow/click-leave path: replace the paragraph with a fresh
      // code_block carrying the captured lang. PM will map the pending
      // selection to the most reasonable neighbouring position (i.e.
      // OUTSIDE this code_block) since code_block is `defining`.
      const codeBlock = schema.nodes.code_block.create({ lang: data.lang }, null);
      tr.replaceWith(pos, pos + paragraph.nodeSize, codeBlock);
    },
  });
}

export const fencedCode: FeatureSpec = {
  name: "code_block",

  plugins: (schema) => [makeFencedPlugin(schema).plugin],

  // test-pretty renderCase for <pre>. Overrides the core switch branch
  // because core delegates `renderNode(codeEl)` back through the feature
  // render map, where `code` (from code.ts) would wrap children in `<c>`
  // — wrong for code_block content (it's a node, not an inline mark).
  //
  // Here we walk <code>'s children ourselves (so the play-caret widget
  // still surfaces as `|` and the trailing-<br/> placeholder is filtered)
  // without passing through the featureRenderCases["code"] wrapper.
  renderCases: {
    pre: (_children, el) => {
      const lang = el.getAttribute("data-lang") ?? "";
      const codeEl = el.querySelector("code");
      let text = "";
      if (codeEl) {
        for (const child of Array.from(codeEl.childNodes)) {
          if (child.nodeType === 3) {
            text += (child as Text).data;
          } else if (child.nodeType === 1) {
            const childEl = child as Element;
            const tag = childEl.tagName.toLowerCase();
            const list = childEl.classList;
            if (tag === "span" && list.contains("play-caret")) text += "|";
            else if (tag === "span" && list.contains("selection-marker"))
              text += childEl.textContent ?? "";
            else if (tag === "br" && list.contains("ProseMirror-trailingBreak")) {
              // skip PM's empty-textblock placeholder
            } else {
              text += childEl.textContent ?? "";
            }
          }
        }
      }
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    },
  },

  keymap: (schema) => ({
    // Intercept Enter ONLY when the cursor sits in a draft paragraph
    // (textContent matches `^```(\w*)$`). Commit the paragraph into a
    // code_block with the captured lang, and park the caret INSIDE
    // the empty code_block body — this is the distinguishing behaviour
    // vs the arrow-leave path (leaveLineDraft's appendTransaction),
    // which lands the caret outside.
    //
    // Outside a draft paragraph we return false so baseKeymap's
    // splitBlock / newlineInCode / etc. continue to handle Enter
    // (including the "newline inside a code_block" case — after commit,
    // Enter should insert a \n in the code_block text).
    Enter: (state, dispatch) => {
      const sel = state.selection;
      if (!sel.empty) return false;
      const $from = sel.$from;
      const para = $from.parent;
      if (para.type.name !== "paragraph") return false;
      const m = FENCE_RE.exec(para.textContent);
      if (!m) return false;
      if (dispatch) {
        const lang = m[1] ?? "";
        const pos = $from.before();
        const codeBlock = schema.nodes.code_block.create({ lang }, null);
        const tr = state.tr.replaceWith(pos, pos + para.nodeSize, codeBlock);
        // pos + 1 = inside the new code_block's content (empty text).
        tr.setSelection(TextSelection.create(tr.doc, pos + 1));
        dispatch(tr);
      }
      return true;
    },

    // Empty code_block + Backspace → delete the entire code_block (not
    // just clear one char). Typora: once main content is empty, a single
    // Backspace removes the block.
    Backspace: (state, dispatch) => {
      const sel = state.selection;
      if (!sel.empty) return false;
      const $from = sel.$from;
      if ($from.parent.type.name !== "code_block") return false;
      if ($from.parent.content.size > 0) return false;
      if (dispatch) {
        const pos = $from.before();
        const size = $from.parent.nodeSize;
        const tr = state.tr.delete(pos, pos + size);
        // If the doc became empty, re-insert a paragraph so the caret
        // has somewhere to land (schema requires at least one block).
        if (tr.doc.content.size === 0) {
          const p = schema.nodes.paragraph.createAndFill();
          if (p) tr.insert(0, p);
        }
        dispatch(tr);
      }
      return true;
    },
  }),

  cases: [
    // ──────────────────────────────────────────────────────────────
    // 1. draft decoration appears once three backticks are on the line
    // ──────────────────────────────────────────────────────────────
    {
      id: "draft-trigger",
      label: "``` enters draft; all three chars show gray",
      seed: "",
      events: ["`", "`", "`"],
      checkpoints: [
        { at: 1, expect: "`|" },
        { at: 2, expect: "``|" },
        { at: 3, expect: "<g>```</g>|" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 2. draft + lang pre-fill: lang chars are NOT gray
    // ──────────────────────────────────────────────────────────────
    {
      id: "draft-with-lang",
      label: "```ts — lang characters are plain (not gray)",
      seed: "",
      events: ["`", "`", "`", "t", "s"],
      checkpoints: [
        { at: 3, expect: "<g>```</g>|" },
        { at: 4, expect: "<g>```</g>t|" },
        { at: 5, expect: "<g>```</g>ts|" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 3. Enter commits; cursor lands INSIDE the new code_block.
    // ──────────────────────────────────────────────────────────────
    {
      id: "enter-commit-inside",
      label: "```ts + Enter → code_block(lang=ts), cursor inside",
      seed: "",
      events: ["`", "`", "`", "t", "s", "<Enter>"],
      checkpoints: [
        { at: 5, expect: "<g>```</g>ts|" },
        { at: 6, expect: "```ts\n|\n```" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 4. After Enter-commit, typing inserts into the code_block.
    //    Enter inside produces a newline (baseKeymap for code_block).
    // ──────────────────────────────────────────────────────────────
    {
      id: "enter-commit-then-type",
      label: "after commit, x<Enter>y types inside the code_block",
      seed: "",
      events: ["`", "`", "`", "t", "s", "<Enter>", "x", "<Enter>", "y"],
      checkpoints: [
        { at: 7, expect: "```ts\nx|\n```" },
        { at: 9, expect: "```ts\nx\ny|\n```" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 5. Enter-commit with empty lang.
    // ──────────────────────────────────────────────────────────────
    {
      id: "enter-commit-no-lang",
      label: "``` + Enter → code_block(lang=''), cursor inside",
      seed: "",
      events: ["`", "`", "`", "<Enter>"],
      checkpoints: [
        { at: 3, expect: "<g>```</g>|" },
        { at: 4, expect: "```\n|\n```" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 6. Typing a space breaks the pattern ^```(\w*)$ → exit draft.
    // ──────────────────────────────────────────────────────────────
    {
      id: "break-match-exits-draft",
      label: "```ts<space> — space breaks \\w*, draft dissolves",
      seed: "",
      events: ["`", "`", "`", "t", "s", " "],
      checkpoints: [
        { at: 5, expect: "<g>```</g>ts|" },
        { at: 6, expect: "```ts |" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 7. Non-line-start ``` should NOT fire (pattern anchored at ^).
    // ──────────────────────────────────────────────────────────────
    {
      id: "non-line-start",
      label: "a``` — backticks not at start of line, no draft",
      seed: "",
      events: ["a", "`", "`", "`"],
      checkpoints: [
        { at: 4, expect: "a```|" },
      ],
    },

    // Out-of-scope this round (see top-of-file notes):
    //   - arrow-leave commit (depends on ArrowUp/Down events landing
    //     on a neighbouring textblock; unit-testable once the test
    //     fixture grows a pre-seeded trailing paragraph)
    //   - autocomplete-click imperative commit (separate unit test
    //     that instantiates a view and calls handle.commit)
    //   - lang-input NodeView overlay visibility
    //   - Backspace-to-collapse empty code_block
  ],
};
