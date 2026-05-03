import type { Node as PMNode, Schema } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import type { FeatureSpec } from "./_types.ts";

// Reference link definition `[label]: url ["title"]` — live UX.
//
// Schema (structured):
//   link_def
//     ref_label  (text*)   the part inside `[ ]:`
//     ref_url    (text*)   underlined plain url
//     ref_title  (text*)   inside `" "`, optional
//
// Two phases:
//
//   1. **Draft**: typing in a paragraph whose text matches `^\[<label>\]:`
//      decorates the syntax chars (`[`, `]:`) with `syntax-hint-italic`.
//      Pretty: `<gi>[</gi>label<gi>]:</gi>...`.
//
//   2. **Commit on Enter**: paragraph text matching the full pattern
//      `^\[<label>\]:\s+<url>(\s+"<title>")?\s*$` is swapped for a
//      structured `link_def` block. The user can still edit each part
//      after commit; empty url / title show grayed placeholders. Cursor
//      lands in the new link_def's label so a follow-up Tab / arrow
//      moves through the parts.
//
//   3. **Enter inside link_def** (post-commit): when the url part has
//      content, Enter creates a new empty link_def below and parks the
//      cursor in its label — chains entries with no manual draft.
//
// Block serializer walks children → `[label]: url ["title"]`. Title is
// emitted only if non-empty.

const REF_DRAFT_RE = /^\[([^\]]+)\]:/;
const REF_COMMIT_RE = /^\[([^\]]+)\]:\s+(\S+)(?:\s+"([^"]*)")?\s*$/;

function refDraftPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decos: Decoration[] = [];
        const cursor = state.selection.empty ? state.selection.from : -1;

        state.doc.descendants((node, pos) => {
          // Draft decorations on paragraphs that look like a starting
          // ref-def (text starts with `[<something>]:`).
          if (node.type.name === "paragraph") {
            const text = node.textContent;
            const m = REF_DRAFT_RE.exec(text);
            if (!m) return false;
            const start = pos + 1;
            const labelLen = m[1]!.length;
            const openBracket = start;
            const closeBracket = start + 1 + labelLen;
            const colonEnd = closeBracket + 2; // `]:`
            decos.push(
              Decoration.inline(openBracket, openBracket + 1, {
                class: "syntax-hint-italic",
              }),
            );
            decos.push(
              Decoration.inline(closeBracket, colonEnd, {
                class: "syntax-hint-italic",
              }),
            );
            return false;
          }

          if (node.type.name !== "link_def") return true;

          // Inside a link_def: emit placeholder attrs on empty url /
          // title parts. URL placeholder is always visible (it prompts
          // the user to fill the required field). TITLE placeholder is
          // gated on cursor-inside-this-link_def — title is optional,
          // so we don't pollute idle defs with the prompt.
          const linkDefStart = pos;
          const linkDefEnd = pos + node.nodeSize;
          const cursorInside = cursor > linkDefStart && cursor < linkDefEnd;

          let childOffset = pos + 1; // skip link_def open
          node.forEach((child) => {
            const childStart = childOffset;
            const childEnd = childStart + child.nodeSize;
            const empty = child.content.size === 0;
            if (empty && child.type.name === "ref_url") {
              decos.push(
                Decoration.node(childStart, childEnd, {
                  "data-placeholder": "input link url here",
                }),
              );
            }
            if (empty && child.type.name === "ref_title" && cursorInside) {
              decos.push(
                Decoration.node(childStart, childEnd, {
                  "data-placeholder": "title (optional)",
                }),
              );
            }
            childOffset = childEnd;
          });
          return false;
        });
        return decos.length > 0
          ? DecorationSet.create(state.doc, decos)
          : DecorationSet.empty;
      },
    },
  });
}

function buildLinkDef(
  schema: Schema,
  label: string,
  href: string,
  title: string,
): PMNode {
  return schema.nodes.link_def.createChecked(null, [
    schema.nodes.ref_label.create(null, label ? [schema.text(label)] : []),
    schema.nodes.ref_url.create(null, href ? [schema.text(href)] : []),
    schema.nodes.ref_title.create(null, title ? [schema.text(title)] : []),
  ]);
}

export const refDef: FeatureSpec = {
  name: "ref-def",

  nodes: {
    link_def: {
      group: "block",
      content: "ref_label ref_url ref_title",
      defining: true,
      isolating: true,
      parseDOM: [{ tag: "ref-def" }],
      toDOM: () => ["ref-def", 0],
    },
    ref_label: {
      content: "text*",
      defining: true,
      parseDOM: [{ tag: "ref-label" }],
      toDOM: () => ["ref-label", 0],
    },
    ref_url: {
      content: "text*",
      defining: true,
      parseDOM: [{ tag: "ref-url" }],
      toDOM: () => ["ref-url", 0],
    },
    ref_title: {
      content: "text*",
      defining: true,
      parseDOM: [{ tag: "ref-title" }],
      toDOM: () => ["ref-title", 0],
    },
  },

  plugins: () => [refDraftPlugin()],

  keymap: (schema) => ({
    Enter: (state, dispatch) => {
      const sel = state.selection;
      if (!sel.empty) return false;
      const $from = sel.$from;

      // Path 1: commit a draft paragraph into a structured link_def.
      if ($from.parent.type.name === "paragraph") {
        const text = $from.parent.textContent;
        const m = REF_COMMIT_RE.exec(text);
        if (!m) return false;
        if (dispatch) {
          const [, label, href, title] = m;
          const node = buildLinkDef(schema, label!, href!, title || "");
          const paraStart = $from.before();
          const paraEnd = $from.after();
          const tr = state.tr;
          tr.replaceWith(paraStart, paraEnd, [
            node,
            schema.nodes.paragraph.create(),
          ]);
          // Cursor inside the new link_def's label.
          const labelInside = paraStart + 2; // link_def open + ref_label open
          tr.setSelection(TextSelection.create(tr.doc, labelInside));
          dispatch(tr);
        }
        return true;
      }

      // Path 2: cursor is inside an existing link_def.
      //   * All three parts empty → delete the el (replace with an
      //     empty paragraph, cursor inside it). Lets the user back out
      //     after creating one too many.
      //   * URL already filled → insert a fresh empty link_def below
      //     and park cursor in its label. Chains entries.
      //   * Otherwise → fall through; Enter inside an editable text
      //     part is meaningless and baseKeymap will absorb it.
      for (let d = $from.depth; d >= 0; d--) {
        const node = $from.node(d);
        if (node.type.name !== "link_def") continue;
        const labelEmpty = node.child(0).content.size === 0;
        const urlEmpty = node.child(1).content.size === 0;
        const titleEmpty = node.child(2).content.size === 0;
        if (labelEmpty && urlEmpty && titleEmpty) {
          if (dispatch) {
            const tr = state.tr;
            const linkDefStart = $from.before(d);
            const linkDefEnd = $from.after(d);
            tr.replaceWith(
              linkDefStart,
              linkDefEnd,
              schema.nodes.paragraph.create(),
            );
            // Cursor inside the fresh paragraph.
            tr.setSelection(TextSelection.create(tr.doc, linkDefStart + 1));
            dispatch(tr);
          }
          return true;
        }
        if (urlEmpty) return false;
        if (dispatch) {
          const linkDefEnd = $from.after(d);
          const fresh = buildLinkDef(schema, "", "", "");
          const tr = state.tr;
          tr.insert(linkDefEnd, fresh);
          // Cursor at the start of the new link_def's label.
          const newLabelInside = linkDefEnd + 2;
          tr.setSelection(TextSelection.create(tr.doc, newLabelInside));
          dispatch(tr);
        }
        return true;
      }

      return false;
    },
  }),

  blockHandlers: {
    link_def: (state, node) => {
      const label = node.child(0).textContent;
      const href = node.child(1).textContent;
      const title = node.child(2).textContent;
      state.write(`[${label}]: ${href}`);
      if (title) state.out += ` "${title}"`;
      state.closeBlock(node);
    },
  },

};
