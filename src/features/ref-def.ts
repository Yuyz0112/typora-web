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
          // Placeholder attrs on empty url / title nodes — CSS reads
          // `data-placeholder` and renders ghost text via ::before.
          if (
            (node.type.name === "ref_url" || node.type.name === "ref_title") &&
            node.content.size === 0
          ) {
            const placeholder =
              node.type.name === "ref_url"
                ? "input link url here"
                : "title (optional)";
            decos.push(
              Decoration.node(pos, pos + node.nodeSize, {
                "data-placeholder": placeholder,
              }),
            );
          }
          return true;
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

      // Path 2: cursor is inside an existing link_def. If the url part
      // already has content, Enter creates a new empty link_def below
      // and parks the cursor in its label. (If url is empty, fall
      // through — Enter is meaningless there, baseKeymap will absorb.)
      for (let d = $from.depth; d >= 0; d--) {
        const node = $from.node(d);
        if (node.type.name !== "link_def") continue;
        const urlNode = node.child(1); // [label, url, title]
        if (urlNode.content.size === 0) return false;
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

  renderCases: {
    "ref-def": (children) => `<ref-def>${children}</ref-def>`,
    "ref-label": (children) => `<rl>${children}</rl>`,
    "ref-url": (children) => `<ru>${children}</ru>`,
    "ref-title": (children) => `<rt>${children}</rt>`,
  },

  cases: [
    {
      id: "type-and-commit",
      label: "[s]: http://x.com<Enter> drafts then commits to structured link_def",
      seed: "",
      events: [
        "[", "s", "]", ":", " ",
        "h", "t", "t", "p", ":", "/", "/", "x", ".", "c", "o", "m",
        "<Enter>",
      ],
      checkpoints: [
        { at: 1, expect: "[|]" },
        { at: 2, expect: "[s|]" },
        { at: 3, expect: "[s]|" },
        { at: 4, expect: "<gi>[</gi>s<gi>]:</gi>|" },
        { at: 5, expect: "<gi>[</gi>s<gi>]:</gi> |" },
        { at: 17, expect: "<gi>[</gi>s<gi>]:</gi> http://x.com|" },
        // Commit: structured node; cursor inside the label.
        {
          at: 18,
          expect:
            "<ref-def><rl>|s</rl><ru>http://x.com</ru><rt></rt></ref-def>",
        },
      ],
    },
    {
      id: "empty-placeholders",
      label: "fresh link_def shows empty url/title slots (placeholders via CSS)",
      // Build via type-and-commit, then leave url empty? Actually we
      // can construct via Enter-inside path: a committed first def +
      // Enter inside it creates a fresh empty one.
      seed: "",
      events: [
        "[", "a", "]", ":", " ", "x", "<Enter>", // commit one
        "<Enter>",                                  // Enter inside → new empty
      ],
      checkpoints: [
        // After first commit (event 7 — auto-pair adds 1 to indices):
        // wait — `[`, `a`, `]`, `:`, ` `, `x`, `<Enter>` is 7 events.
        // After commit cursor is inside the label of the first def.
        {
          at: 7,
          expect:
            "<ref-def><rl>|a</rl><ru>x</ru><rt></rt></ref-def>",
        },
        // Enter while url is filled → new empty link_def below.
        {
          at: 8,
          expect:
            "<ref-def><rl>a</rl><ru>x</ru><rt></rt></ref-def>\n<ref-def><rl>|</rl><ru></ru><rt></rt></ref-def>",
        },
      ],
    },
    {
      id: "incomplete-no-commit",
      label: "[s]:<Enter> (no url) — Enter doesn't trigger commit",
      seed: "",
      events: ["[", "s", "]", ":", "<Enter>"],
      checkpoints: [
        { at: 4, expect: "<gi>[</gi>s<gi>]:</gi>|" },
        { at: 5, expect: "<gi>[</gi>s<gi>]:</gi>\n|" },
      ],
    },
    {
      id: "with-title",
      label: '[s]: url "T"<Enter> — title preserved',
      seed: "",
      events: [
        "[", "s", "]", ":", " ", "x", " ", '"', "T", '"', "<Enter>",
      ],
      checkpoints: [
        {
          at: 11,
          expect:
            "<ref-def><rl>|s</rl><ru>x</ru><rt>T</rt></ref-def>",
        },
      ],
    },
  ],
};
