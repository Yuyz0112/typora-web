import { Schema, type NodeSpec, type MarkSpec } from "prosemirror-model";

const nodes: Record<string, NodeSpec> = {
  doc: { content: "block+" },

  paragraph: {
    group: "block",
    content: "inline*",
    parseDOM: [{ tag: "p" }],
    toDOM: () => ["p", 0],
  },

  heading: {
    group: "block",
    content: "inline*",
    attrs: { level: { default: 1 } },
    defining: true,
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      attrs: { level },
    })),
    toDOM: (node) => [`h${node.attrs.level as number}`, 0],
  },

  blockquote: {
    group: "block",
    content: "block+",
    defining: true,
    parseDOM: [{ tag: "blockquote" }],
    toDOM: () => ["blockquote", 0],
  },

  code_block: {
    group: "block",
    content: "text*",
    marks: "",
    code: true,
    defining: true,
    attrs: { lang: { default: "" } },
    parseDOM: [
      {
        tag: "pre",
        preserveWhitespace: "full",
        getAttrs: (el) => ({ lang: (el as HTMLElement).getAttribute("data-lang") ?? "" }),
      },
    ],
    toDOM: (node) => [
      "pre",
      node.attrs.lang ? { "data-lang": node.attrs.lang as string } : {},
      ["code", 0],
    ],
  },

  horizontal_rule: {
    group: "block",
    parseDOM: [{ tag: "hr" }],
    toDOM: () => ["hr"],
  },

  bullet_list: {
    group: "block",
    content: "list_item+",
    parseDOM: [{ tag: "ul" }],
    toDOM: () => ["ul", 0],
  },

  ordered_list: {
    group: "block",
    content: "list_item+",
    attrs: { start: { default: 1 } },
    parseDOM: [
      {
        tag: "ol",
        getAttrs: (el) => {
          const start = (el as HTMLElement).getAttribute("start");
          return { start: start ? Number(start) : 1 };
        },
      },
    ],
    toDOM: (node) => {
      const start = node.attrs.start as number;
      return ["ol", start === 1 ? {} : { start }, 0];
    },
  },

  list_item: {
    content: "paragraph block*",
    defining: true,
    parseDOM: [{ tag: "li" }],
    toDOM: () => ["li", 0],
  },

  text: { group: "inline" },

  hard_break: {
    group: "inline",
    inline: true,
    selectable: false,
    parseDOM: [{ tag: "br" }],
    toDOM: () => ["br"],
  },
};

const marks: Record<string, MarkSpec> = {
  strong: {
    parseDOM: [{ tag: "strong" }, { tag: "b" }],
    toDOM: () => ["strong", 0],
  },

  em: {
    parseDOM: [{ tag: "em" }, { tag: "i" }],
    toDOM: () => ["em", 0],
  },

  code: {
    parseDOM: [{ tag: "code" }],
    toDOM: () => ["code", 0],
  },

  link: {
    attrs: {
      href: {},
      title: { default: null },
    },
    inclusive: false,
    parseDOM: [
      {
        tag: "a[href]",
        getAttrs: (el) => ({
          href: (el as HTMLElement).getAttribute("href"),
          title: (el as HTMLElement).getAttribute("title"),
        }),
      },
    ],
    toDOM: (mark) => {
      const { href, title } = mark.attrs as { href: string; title: string | null };
      return ["a", title ? { href, title } : { href }, 0];
    },
  },
};

export const schema = new Schema({ nodes, marks });
