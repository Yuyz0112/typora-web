import { markExtRanges, scanFixedDelim } from "../inline-parse.ts";
import type { FeatureSpec } from "./_types.ts";

// code in Typora-pilot (method B) mode — see emphasis.ts.

export const code: FeatureSpec = {
  name: "code",

  marks: {
    code: {
      parseDOM: [{ tag: "code" }],
      toDOM: () => ["code", 0],
    },
  },

  parserTokens: {
    code_inline: (state, tok, schema) => {
      state.addText("`");
      state.openMark(schema.marks.code.create());
      state.addText(tok.content);
      state.closeMarkType(schema.marks.code);
      state.addText("`");
    },
  },

  markDelims: {
    code: { open: "", close: "" },
  },

  renderCases: {
    code: (children) => `<c>${children}</c>`,
  },

  inline: {
    priority: 0, // code wins over everything else (`\*x\*` inside backticks)
    scan: (text, consumed) => scanFixedDelim(text, "`", 1, "code", consumed),
    markNames: ["code"],
    extRanges: (parent) => markExtRanges(parent, "code", 1),
  },

  cases: [
    {
      id: "backticks",
      label: "inline code via single backticks",
      seed: "",
      events: ["`", "1", "`", " "],
      checkpoints: [
        { at: 1, expect: "`|" },
        { at: 2, expect: "`1|" },
        { at: 3, expect: "<g>`</g><c>1</c><g>`</g>|" },
        { at: 4, expect: "<c>1</c> |" },
      ],
    },
  ],
};
