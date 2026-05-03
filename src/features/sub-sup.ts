import { markExtRanges, scanFixedDelim } from "../inline-parse.ts";
import type { FeatureSpec } from "./_types.ts";

// Typora extensions:
//   subscript    `~x~`   (single tilde — disambiguates from strike's `~~`)
//   superscript  `^x^`   (single caret)
//
// Both go via method-B with `scanFixedDelim`. The `~` delim collides with
// strike at the lexical level: scanRuns of `~~~hello~~~` would yield one
// 3-char run on each side. Strike (priority 1, len 2) tries to claim,
// finds inner `~hello~` containing `~`, gives up. Sub (priority 1.2,
// len 1) likewise finds inner with `~` chars, gives up. So `~~~x~~~` is
// neither strike nor sub — fine, that's the only intentionally-skipped
// edge case here.
//
// For `~x~` (single pair), strike scan rejects (run length < 2); sub
// claims. For `~~x~~` (double pair), strike scan claims first via the
// shared `consumed` bitmap; sub runs second on the priority queue and
// the chars are already consumed.

export const subSup: FeatureSpec = {
  name: "sub-sup",

  marks: {
    sub: {
      parseDOM: [{ tag: "sub" }],
      toDOM: () => ["sub", 0],
    },
    sup: {
      parseDOM: [{ tag: "sup" }],
      toDOM: () => ["sup", 0],
    },
  },

  // markdown-it has no built-in sub/sup. Method-B doesn't require parser-
  // side recognition (text flows through, scanner derives mark) — same
  // strategy as `highlight`.

  markDelims: {
    sub: { open: "", close: "" },
    sup: { open: "", close: "" },
  },

  inline: {
    // Run after strike (1) so strike's `~~` claims its chars first; before
    // highlight (1.5) and emphasis (2) — `^`/`~` don't collide with those
    // anyway, position is mostly cosmetic.
    priority: 1.2,
    scan: (text, consumed) => {
      const subs = scanFixedDelim(text, "~", 1, "sub", consumed);
      const sups = scanFixedDelim(text, "^", 1, "sup", consumed);
      return [...subs, ...sups];
    },
    markNames: ["sub", "sup"],
    extRanges: (parent) => [
      ...markExtRanges(parent, "sub", 1),
      ...markExtRanges(parent, "sup", 1),
    ],
  },

};
