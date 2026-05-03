import type { Node as PMNode, Schema } from "prosemirror-model";
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
} from "prosemirror-state";
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeView,
} from "prosemirror-view";

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
// Post-commit affordances implemented here:
//
//   - NodeView renders a chrome overlay next to the `<code>` body
//     containing a `<input class="cb-lang-input">` for editing the
//     code_block's `lang` attribute. Chrome shows only when the caret
//     is inside the block (CSS-only: decoration toggles `cb-active`).
//
//   - Arrow navigation: from the LAST position of the main code body,
//     ArrowDown "enters" the lang input (a virtual plugin state).
//     From the lang input, ArrowUp returns to the end of the main body.
//     From a block IMMEDIATELY AFTER a code_block, ArrowUp enters that
//     preceding code_block's lang input instead of the usual last-line.
//
//     The lang-focus state is tracked by a PluginKey and visualized
//     three ways:
//       * NodeView adds `cb-lang-focus` class to the outer <pre>, which
//         CSS uses to hide the .play-caret inside the code body and
//         focus() the input.
//       * Pretty renderCase reads `data-lang-focus` on <pre> and emits
//         the `|` marker AFTER the lang string instead of inside the
//         code body.
//       * PM selection is kept at the end of the code body so that
//         "leaving" the lang input naturally resumes editing there.

const FENCE_RE = /^```(\w*)$/;

// ─────────────────────────────────────────────────────────────────────────────
// lang-focus plugin state: which code_block (by pos) currently owns the
// virtual cursor inside its lang input. Empty = cursor lives in PM doc.
// ─────────────────────────────────────────────────────────────────────────────

type LangFocus = { pos: number } | null;

const langFocusKey = new PluginKey<LangFocus>("fencedCodeLangFocus");

export function getLangFocus(state: EditorState): LangFocus {
  return langFocusKey.getState(state) ?? null;
}

// Find the pos of the code_block containing a doc position, or null.
function codeBlockPosAt(state: EditorState, pos: number): number | null {
  const $ = state.doc.resolve(pos);
  for (let d = $.depth; d >= 0; d--) {
    const node = $.node(d);
    if (node.type.name === "code_block") return $.before(d);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// NodeView: outer <pre data-lang><code/></pre> plus a chrome overlay with
// a <input class="cb-lang-input">. The input mutates code_block.attrs.lang
// via setNodeAttribute.
// ─────────────────────────────────────────────────────────────────────────────

class CodeBlockView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private chromeEl: HTMLElement;
  private inputEl: HTMLInputElement;
  private view: EditorView;
  private getPos: () => number | undefined;

  constructor(
    node: PMNode,
    view: EditorView,
    getPos: () => number | undefined,
    decorations: readonly Decoration[] = [],
  ) {
    this.view = view;
    this.getPos = getPos;
    const pre = document.createElement("pre");
    const lang = (node.attrs.lang as string) ?? "";
    if (lang) pre.setAttribute("data-lang", lang);
    const code = document.createElement("code");
    pre.appendChild(code);

    const chrome = document.createElement("div");
    chrome.className = "cb-chrome";
    chrome.setAttribute("contenteditable", "false");
    const input = document.createElement("input");
    input.className = "cb-lang-input";
    input.placeholder = "lang";
    input.value = lang;
    input.spellcheck = false;
    chrome.appendChild(input);
    pre.appendChild(chrome);

    this.dom = pre;
    this.contentDOM = code;
    this.chromeEl = chrome;
    this.inputEl = input;

    input.addEventListener("input", this.onInput);
    input.addEventListener("keydown", this.onInputKeyDown);
    input.addEventListener("mousedown", (e) => e.stopPropagation());
    // Apply initial decorations (PM doesn't call update() right after
    // construction with the starting deco set — do it manually).
    this.applyDecorations(decorations);
  }

  private applyDecorations(decorations: readonly Decoration[]): void {
    let active = false;
    let langFocus = false;
    for (const d of decorations) {
      const spec = (d as unknown as { spec?: { cbActive?: boolean; cbLangFocus?: boolean } }).spec;
      if (spec?.cbActive) active = true;
      if (spec?.cbLangFocus) langFocus = true;
    }
    this.dom.classList.toggle("cb-active", active || langFocus);
    this.dom.classList.toggle("cb-lang-focus", langFocus);
    if (langFocus) this.dom.setAttribute("data-lang-focus", "1");
    else this.dom.removeAttribute("data-lang-focus");
    if (langFocus && typeof this.inputEl.focus === "function") {
      try { this.inputEl.focus(); } catch { /* ignore */ }
    }
  }

  private onInput = (): void => {
    const pos = this.getPos();
    if (pos == null) return;
    const newLang = this.inputEl.value;
    const tr = this.view.state.tr.setNodeAttribute(pos, "lang", newLang);
    // Preserve virtual lang-focus across the tr (setMeta to same pos).
    tr.setMeta(langFocusKey, { pos });
    this.view.dispatch(tr);
  };

  private onInputKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "ArrowUp" || (e.key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      const pos = this.getPos();
      if (pos == null) return;
      const node = this.view.state.doc.nodeAt(pos);
      if (!node) return;
      // Move PM selection to end of code body, clear lang-focus.
      const endInside = pos + node.nodeSize - 1;
      const tr = this.view.state.tr.setSelection(
        TextSelection.create(this.view.state.doc, endInside),
      );
      tr.setMeta(langFocusKey, null);
      this.view.dispatch(tr);
      this.view.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const pos = this.getPos();
      if (pos == null) return;
      const node = this.view.state.doc.nodeAt(pos);
      if (!node) return;
      const afterBlock = pos + node.nodeSize;
      const tr = this.view.state.tr;
      tr.setMeta(langFocusKey, null);
      if (afterBlock < this.view.state.doc.content.size) {
        tr.setSelection(TextSelection.create(tr.doc, afterBlock + 1));
      } else {
        // At doc end: append a paragraph below (Typora style).
        const paraType = this.view.state.schema.nodes.paragraph;
        const newPara = paraType?.createAndFill();
        if (newPara) {
          tr.insert(afterBlock, newPara);
          tr.setSelection(TextSelection.create(tr.doc, afterBlock + 1));
        }
      }
      this.view.dispatch(tr);
      this.view.focus();
    }
  };

  update(node: PMNode, decorations: readonly Decoration[]): boolean {
    if (node.type.name !== "code_block") return false;
    const lang = (node.attrs.lang as string) ?? "";
    if (lang) this.dom.setAttribute("data-lang", lang);
    else this.dom.removeAttribute("data-lang");
    if (this.inputEl.value !== lang) this.inputEl.value = lang;
    this.applyDecorations(decorations);
    return true;
  }

  // The input is non-PM DOM; PM should not process clicks/keys inside it.
  stopEvent(e: Event): boolean {
    return this.chromeEl.contains(e.target as Node);
  }

  ignoreMutation(m: { target: Node }): boolean {
    return this.chromeEl.contains(m.target);
  }

  destroy(): void {
    this.inputEl.removeEventListener("input", this.onInput);
    this.inputEl.removeEventListener("keydown", this.onInputKeyDown);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Plugin: nodeView registration, chrome-visibility decorations, lang-focus
// state, and ArrowUp/Down handlers for crossing main ↔ lang-input.
// ─────────────────────────────────────────────────────────────────────────────

function fencedCodeChromePlugin(): Plugin<LangFocus> {
  return new Plugin<LangFocus>({
    key: langFocusKey,
    state: {
      init: () => null,
      apply: (tr, old) => {
        const m = tr.getMeta(langFocusKey);
        if (m === null) return null;
        if (m !== undefined) return m as LangFocus;
        // Map old pos through tr.mapping; if code_block no longer exists, drop.
        if (!old) return null;
        const mapped = tr.mapping.map(old.pos);
        const node = tr.doc.nodeAt(mapped);
        if (!node || node.type.name !== "code_block") return null;
        return { pos: mapped };
      },
    },
    props: {
      nodeViews: {
        code_block: (node, view, getPos, decorations) =>
          new CodeBlockView(node, view, getPos, decorations as readonly Decoration[]),
      },
      decorations(state) {
        const decos: Decoration[] = [];
        // Active = cursor sits inside a code_block.
        const sel = state.selection;
        if (sel.empty) {
          const cbPos = codeBlockPosAt(state, sel.from);
          if (cbPos !== null) {
            const node = state.doc.nodeAt(cbPos);
            if (node) {
              decos.push(
                Decoration.node(
                  cbPos,
                  cbPos + node.nodeSize,
                  { class: "cb-active" },
                  { cbActive: true },
                ),
              );
            }
          }
        }
        const lf = langFocusKey.getState(state);
        if (lf) {
          const node = state.doc.nodeAt(lf.pos);
          if (node && node.type.name === "code_block") {
            decos.push(
              Decoration.node(
                lf.pos,
                lf.pos + node.nodeSize,
                { class: "cb-active cb-lang-focus" },
                { cbActive: true, cbLangFocus: true },
              ),
            );
          }
        }
        return decos.length > 0 ? DecorationSet.create(state.doc, decos) : null;
      },
      handleKeyDown(view, e) {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return false;
        if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
        const state = view.state;
        const lf = langFocusKey.getState(state);

        // Case A: already in lang-focus → ArrowUp exits back to code body,
        // ArrowDown exits to the block below (or spawns one).
        if (lf) {
          const node = state.doc.nodeAt(lf.pos);
          if (!node || node.type.name !== "code_block") {
            view.dispatch(state.tr.setMeta(langFocusKey, null));
            return true;
          }
          if (e.key === "ArrowUp") {
            const endInside = lf.pos + node.nodeSize - 1;
            const tr = state.tr
              .setSelection(TextSelection.create(state.doc, endInside))
              .setMeta(langFocusKey, null);
            view.dispatch(tr);
            return true;
          }
          // ArrowDown
          const afterBlock = lf.pos + node.nodeSize;
          const tr = state.tr.setMeta(langFocusKey, null);
          if (afterBlock < state.doc.content.size) {
            tr.setSelection(TextSelection.create(tr.doc, afterBlock + 1));
          } else {
            const paraType = state.schema.nodes.paragraph;
            const newPara = paraType?.createAndFill();
            if (newPara) {
              tr.insert(afterBlock, newPara);
              tr.setSelection(TextSelection.create(tr.doc, afterBlock + 1));
            }
          }
          view.dispatch(tr);
          return true;
        }

        const sel = state.selection;
        if (!sel.empty) return false;
        const $from = sel.$from;

        // Case B: cursor at END of a code_block's body → ArrowDown enters
        // that code_block's lang input.
        if (
          e.key === "ArrowDown" &&
          $from.parent.type.name === "code_block" &&
          $from.parentOffset === $from.parent.content.size
        ) {
          const cbPos = $from.before();
          // PM selection stays put (end of code body); lang-focus hides
          // the caret via `data-lang-focus` + CSS `.cb-lang-focus
          // .play-caret{display:none}` and the pretty renderCase.
          view.dispatch(state.tr.setMeta(langFocusKey, { pos: cbPos }));
          return true;
        }

        // Case C: cursor at START of a block whose previous sibling is a
        // code_block → ArrowUp enters that preceding code_block's lang input.
        if (
          e.key === "ArrowUp" &&
          $from.depth >= 1 &&
          $from.parentOffset === 0
        ) {
          const parentPos = $from.before();
          if (parentPos > 0) {
            // Previous sibling starts at the depth-1 index just before.
            const $before = state.doc.resolve(parentPos);
            const index = $before.index();
            if (index > 0) {
              const prev = $before.parent.child(index - 1);
              if (prev.type.name === "code_block") {
                const prevPos = parentPos - prev.nodeSize;
                // Park PM selection at the end of the prev code_block's body
                // so the PM caret isn't left in the block below. It gets
                // hidden by `data-lang-focus`; on ArrowUp-exit it becomes
                // visible at the body end, which is what the user wants.
                const endInside = prevPos + prev.nodeSize - 1;
                const tr = state.tr
                  .setSelection(TextSelection.create(state.doc, endInside))
                  .setMeta(langFocusKey, { pos: prevPos });
                view.dispatch(tr);
                return true;
              }
            }
          }
        }
        return false;
      },
    },
  });
}

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

  plugins: (schema) => [makeFencedPlugin(schema).plugin, fencedCodeChromePlugin()],

  // test-pretty renderCase for <pre>. Overrides the core switch branch
  // because core delegates `renderNode(codeEl)` back through the feature
  // render map, where `code` (from code.ts) would wrap children in `<c>`
  // — wrong for code_block content (it's a node, not an inline mark).
  //
  // Here we walk <code>'s children ourselves (so the play-caret widget
  // still surfaces as `|` and the trailing-<br/> placeholder is filtered)
  // without passing through the featureRenderCases["code"] wrapper.
  //
  // NodeView additions the renderCase must respect:
  //   * <div class="cb-chrome"> is a sibling of <code>; ignored for md.
  //   * When the <pre> has attr `data-lang-focus`, the caret lives in
  //     the lang input (virtual) and must NOT be rendered inside <code>.
  //     Instead, emit `|` after the lang string in the opening fence.

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

};
