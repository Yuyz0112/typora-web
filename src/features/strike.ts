import { markExtRanges, scanFixedDelim } from "../inline-parse.ts";
import type { FeatureSpec } from "./_types.ts";

// strike in Typora-pilot (method B) mode — see emphasis.ts.

export const strike: FeatureSpec = {
  name: "strike",

  marks: {
    strike: {
      parseDOM: [{ tag: "s" }, { tag: "del" }],
      toDOM: () => ["s", 0],
    },
  },

  // markdown-it ships a strikethrough rule but the commonmark preset disables it.
  mdItPlugins: [(md) => md.enable("strikethrough")],

  parserTokens: {
    s_open: (state, _tok, schema) => {
      state.addText("~~");
      state.openMark(schema.marks.strike.create());
    },
    s_close: (state, _tok, schema) => {
      state.closeMarkType(schema.marks.strike);
      state.addText("~~");
    },
  },

  markDelims: {
    strike: { open: "", close: "" },
  },

  renderCases: {
    s: (children) => `<s>${children}</s>`,
    del: (children) => `<s>${children}</s>`,
  },

  inline: {
    priority: 1, // between code (0) and emphasis (2)
    scan: (text, consumed) => scanFixedDelim(text, "~", 2, "strike", consumed),
    markNames: ["strike"],
    extRanges: (parent) => markExtRanges(parent, "strike", 2),
  },

  cases: [
    {
      id: "double-tilde",
      label: "strike via double tildes",
      seed: "",
      events: ["~", "~", "1", "~", "~", " "],
      checkpoints: [
        { at: 2, expect: "~~|" },
        { at: 3, expect: "~~1|" },
        { at: 5, expect: "<g>~~</g><s>1</s><g>~~</g>|" },
        { at: 6, expect: "<s>1</s> |" },
      ],
    },
  ],
};
