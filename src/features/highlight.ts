import { markExtRanges, scanFixedDelim } from "../inline-parse.ts";
import type { FeatureSpec } from "./_types.ts";

// Typora-style highlight `==x==` (method B) — straight analog of strike.
//
// markdown-it has no built-in `mark` rule, but method-B doesn't need
// parser-side recognition: `==x==` flows through as plain text and the
// normalize step derives the mark from the inline scanner. Round-trip
// works because extRanges flags the `==` chars as raw text (no \-escape).

export const highlight: FeatureSpec = {
  name: "highlight",

  marks: {
    highlight: {
      parseDOM: [{ tag: "mark" }],
      toDOM: () => ["mark", 0],
    },
  },

  markDelims: {
    highlight: { open: "", close: "" },
  },

  renderCases: {
    mark: (children) => `<mark>${children}</mark>`,
  },

  inline: {
    priority: 1.5, // between strike (1) and emphasis (2); delim char `=` doesn't collide
    scan: (text, consumed) => scanFixedDelim(text, "=", 2, "highlight", consumed),
    markNames: ["highlight"],
    extRanges: (parent) => markExtRanges(parent, "highlight", 2),
  },

  cases: [
    {
      id: "double-eq",
      label: "highlight via double equals",
      seed: "",
      events: ["=", "=", "k", "=", "=", " "],
      checkpoints: [
        { at: 1, expect: "=|" },
        { at: 2, expect: "==|" },
        { at: 3, expect: "==k|" },
        { at: 4, expect: "==k=|" },
        { at: 5, expect: "<g>==</g><mark>k</mark><g>==</g>|" },
        { at: 6, expect: "<mark>k</mark> |" },
      ],
    },
  ],
};
