import { Plugin, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import type { FeatureSpec } from "./_types.ts";

// Reference link definition `[label]: url ["title"]` — live editor input.
//
// Two phases:
//   1. **Draft**: as the user types in a paragraph and the textContent
//      starts matching `^\[<label>\]:`, the syntax chars (`[`, `]`, `:`)
//      get a `syntax-hint-italic` class — gray + italic, the canonical
//      "you're in a special-syntax line" hint. The label and any url
//      typed after stay as normal text, fully editable.
//   2. **Commit on Enter**: when the textContent matches the full
//      pattern `^\[<label>\]:\s+<url>(\s+"<title>")?\s*$`, Enter swaps
//      the paragraph for an atom `link_def` block; cursor lands in a
//      fresh paragraph below.
//
// Atom block render: a `<ref-def>` element with the label and url as
// editable-looking spans; the surrounding `[`, `]`, `:` glyphs come
// from CSS `::before`/`::after` decoration so the user can't navigate
// into them. Pretty: `<ref>label</ref> url`.
//
// Round-trip caveat: serializes to `[label]: url` and the matching
// md-it parse rule consumes it silently (so on reload the def node
// is dropped, while the inline `[text][label]` references still
// resolve to inline links via md-it's resolver). True preservation
// would need a custom md-it block rule + a parserPostProcess; that's
// a phase-2 follow-up.

// Draft trigger: at minimum `[<at least one char>]:`. Url after is
// optional during draft.
const REF_DRAFT_RE = /^\[([^\]]+)\]:/;

// Full commit pattern: label, colon, whitespace, url (no spaces),
// optional `"title"`. Anchored to the whole line.
const REF_COMMIT_RE =
  /^\[([^\]]+)\]:\s+(\S+)(?:\s+"([^"]*)")?\s*$/;

function refDraftPlugin(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decos: Decoration[] = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== "paragraph") return true;
          const text = node.textContent;
          const m = REF_DRAFT_RE.exec(text);
          if (!m) return false;
          // Inside the paragraph: pos+1 = first char (the `[`).
          const start = pos + 1;
          const labelLen = m[1]!.length;
          const openBracket = start;
          const closeBracket = start + 1 + labelLen;
          const colon = closeBracket + 1;
          decos.push(
            Decoration.inline(openBracket, openBracket + 1, {
              class: "syntax-hint-italic",
            }),
          );
          // `]:` as one range so PM renders a single <span> — separate
          // decorations would each get their own wrapper.
          decos.push(
            Decoration.inline(closeBracket, colon + 1, {
              class: "syntax-hint-italic",
            }),
          );
          return false;
        });
        return decos.length > 0
          ? DecorationSet.create(state.doc, decos)
          : DecorationSet.empty;
      },
    },
  });
}

export const refDef: FeatureSpec = {
  name: "ref-def",

  nodes: {
    link_def: {
      group: "block",
      atom: true,
      selectable: true,
      defining: true,
      attrs: {
        label: {},
        href: {},
        title: { default: null },
      },
      parseDOM: [
        {
          tag: "ref-def",
          getAttrs: (el) => ({
            label: (el as HTMLElement).getAttribute("data-label") ?? "",
            href: (el as HTMLElement).getAttribute("data-href") ?? "",
            title: (el as HTMLElement).getAttribute("data-title") || null,
          }),
        },
      ],
      toDOM: (node) => {
        const label = node.attrs.label as string;
        const href = node.attrs.href as string;
        const title = node.attrs.title as string | null;
        const dataAttrs: Record<string, string> = {
          "data-label": label,
          "data-href": href,
          contenteditable: "false",
        };
        if (title) dataAttrs["data-title"] = title;
        const children: Array<unknown> = [
          ["span", { class: "ref-def-label" }, label],
          " ",
          ["span", { class: "ref-def-url" }, href],
        ];
        if (title) {
          children.push(" ");
          children.push(["span", { class: "ref-def-title" }, `"${title}"`]);
        }
        return ["ref-def", dataAttrs, ...(children as never[])];
      },
    },
  },

  plugins: () => [refDraftPlugin()],

  keymap: (schema) => ({
    Enter: (state, dispatch) => {
      const sel = state.selection;
      if (!sel.empty) return false;
      const $from = sel.$from;
      if ($from.parent.type.name !== "paragraph") return false;
      const text = $from.parent.textContent;
      const m = REF_COMMIT_RE.exec(text);
      if (!m) return false;
      if (dispatch) {
        const [, label, href, title] = m;
        const linkDefType = schema.nodes.link_def;
        const node = linkDefType.create({
          label,
          href,
          title: title || null,
        });
        const paraStart = $from.before();
        const paraEnd = $from.after();
        const tr = state.tr;
        tr.replaceWith(paraStart, paraEnd, [
          node,
          schema.nodes.paragraph.create(),
        ]);
        const newCursor = paraStart + node.nodeSize + 1;
        tr.setSelection(TextSelection.create(tr.doc, newCursor));
        dispatch(tr);
      }
      return true;
    },
  }),

  blockHandlers: {
    link_def: (state, node) => {
      const label = node.attrs.label as string;
      const href = node.attrs.href as string;
      const title = node.attrs.title as string | null;
      state.write(`[${label}]: ${href}`);
      if (title) state.out += ` "${title}"`;
      state.closeBlock(node);
    },
  },

  renderCases: {
    "ref-def": (_children, el) => {
      const label =
        el.querySelector(".ref-def-label")?.textContent ?? "";
      const url = el.querySelector(".ref-def-url")?.textContent ?? "";
      const title =
        el.querySelector(".ref-def-title")?.textContent ?? "";
      const titleSuffix = title ? ` ${title}` : "";
      return `<ref>${label}</ref> ${url}${titleSuffix}`;
    },
  },

  cases: [
    {
      id: "type-and-commit",
      label: "[s]: http://x.com<Enter> drafts then commits to ref-def",
      seed: "",
      events: [
        "[", "s", "]", ":", " ",
        "h", "t", "t", "p", ":", "/", "/", "x", ".", "c", "o", "m",
        "<Enter>",
      ],
      checkpoints: [
        // auto-pair on `[`
        { at: 1, expect: "[|]" },
        { at: 2, expect: "[s|]" },
        { at: 3, expect: "[s]|" },
        // `:` typed: paragraph now matches REF_DRAFT_RE; syntax chars
        // become gray-italic.
        { at: 4, expect: "<gi>[</gi>s<gi>]:</gi>|" },
        { at: 5, expect: "<gi>[</gi>s<gi>]:</gi> |" },
        { at: 17, expect: "<gi>[</gi>s<gi>]:</gi> http://x.com|" },
        // Enter commits — paragraph swapped for link_def block; cursor
        // in the fresh trailing paragraph.
        { at: 18, expect: "<ref>s</ref> http://x.com\n|" },
      ],
    },
    {
      id: "incomplete-no-commit",
      label: "[s]:<Enter> (no url) — draft stays, Enter doesn't trigger",
      seed: "",
      events: ["[", "s", "]", ":", "<Enter>"],
      checkpoints: [
        { at: 4, expect: "<gi>[</gi>s<gi>]:</gi>|" },
        // No commit; Enter splits the paragraph normally. The new
        // empty paragraph below doesn't match REF_DRAFT_RE so its
        // chars stay plain.
        { at: 5, expect: "<gi>[</gi>s<gi>]:</gi>\n|" },
      ],
    },
    {
      id: "with-title",
      label: '[s]: url "title"<Enter> — title preserved',
      seed: "",
      events: [
        "[", "s", "]", ":", " ", "x", " ", '"', "T", '"', "<Enter>",
      ],
      checkpoints: [
        // The paragraph contains `[s]: x "T"`; commit fires on Enter.
        { at: 11, expect: '<ref>s</ref> x "T"\n|' },
      ],
    },
  ],
};
