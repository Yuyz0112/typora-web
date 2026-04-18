import {
  markConsumed,
  markExtRanges,
  scanRuns,
  type InlineSpan,
} from "../inline-parse.ts";
import type { FeatureSpec, InlineFeatureSpec } from "./_types.ts";

// em + strong are one feature under method-B because they share a single
// delim scanner over `*` runs: each pair resolves to strong (2 chars on
// each end) when possible, otherwise em (1 char). Splitting them would
// mean two scanners racing over the same runs.
//
// Typora-style greedy outermost: the leftmost canOpen run pairs with the
// rightmost canClose run; open delims are consumed from the LEFT of the
// run, close delims from the RIGHT — so `**1*` pairs as em("*1") with
// outer `*`s as delims (CommonMark would go the other way).

const scan: InlineFeatureSpec["scan"] = (text, consumed) => {
  const out: InlineSpan[] = [];
  const runs = scanRuns(text, "*", consumed);
  const used = new Set<number>();
  for (let a = 0; a < runs.length; a++) {
    if (used.has(a)) continue;
    const open = runs[a]!;
    if (!open.canOpen) continue;
    let b = -1;
    for (let k = runs.length - 1; k > a; k--) {
      if (used.has(k)) continue;
      if (runs[k]!.canClose) {
        b = k;
        break;
      }
    }
    if (b === -1) continue;
    const close = runs[b]!;

    const wantLen = Math.min(open.len, close.len) >= 2 ? 2 : 1;
    const openFrom = open.pos;
    const openTo = openFrom + wantLen;
    const closeTo = close.pos + close.len;
    const closeFrom = closeTo - wantLen;
    const innerFrom = openTo;
    const innerTo = closeFrom;
    if (innerFrom >= innerTo) continue;
    if (/\s/.test(text[innerFrom]!) || /\s/.test(text[innerTo - 1]!)) continue;

    markConsumed(consumed, openFrom, closeTo);
    used.add(a);
    used.add(b);
    out.push({
      type: wantLen === 2 ? "strong" : "em",
      from: innerFrom,
      to: innerTo,
      openFrom,
      openTo,
      closeFrom,
      closeTo,
    });
  }
  return out;
};

export const emphasis: FeatureSpec = {
  name: "emphasis",

  marks: {
    em: {
      parseDOM: [{ tag: "em" }, { tag: "i" }],
      toDOM: () => ["em", 0],
    },
    strong: {
      parseDOM: [{ tag: "strong" }, { tag: "b" }],
      toDOM: () => ["strong", 0],
    },
  },

  parserTokens: {
    em_open: (state, _tok, schema) => {
      state.addText("*");
      state.openMark(schema.marks.em.create());
    },
    em_close: (state, _tok, schema) => {
      state.closeMarkType(schema.marks.em);
      state.addText("*");
    },
    strong_open: (state, _tok, schema) => {
      state.addText("**");
      state.openMark(schema.marks.strong.create());
    },
    strong_close: (state, _tok, schema) => {
      state.closeMarkType(schema.marks.strong);
      state.addText("**");
    },
  },

  markDelims: {
    em: { open: "", close: "" },
    strong: { open: "", close: "" },
  },

  renderCases: {
    em: (children) => `<i>${children}</i>`,
    i: (children) => `<i>${children}</i>`,
    strong: (children) => `<b>${children}</b>`,
    b: (children) => `<b>${children}</b>`,
  },

  inline: {
    priority: 2,
    scan,
    markNames: ["em", "strong"],
    extRanges: (parent) => [
      ...markExtRanges(parent, "em", 1),
      ...markExtRanges(parent, "strong", 2),
    ],
  },

  cases: [
    {
      id: "asterisks",
      label: "italic via single asterisks",
      seed: "",
      events: ["*", "1", "*", " "],
      checkpoints: [
        { at: 1, expect: "*|" },
        { at: 2, expect: "*1|" },
        { at: 3, expect: "<g>*</g><i>1</i><g>*</g>|" },
        { at: 4, expect: "<i>1</i> |" },
      ],
    },
    {
      id: "double-asterisks",
      label: "bold via double asterisks",
      seed: "",
      events: ["*", "*", "1", "*", "*", " "],
      checkpoints: [
        { at: 2, expect: "**|" },
        { at: 3, expect: "**1|" },
        { at: 4, expect: "<g>*</g><i>*1</i><g>*</g>|" },
        { at: 5, expect: "<g>**</g><b>1</b><g>**</g>|" },
        { at: 6, expect: "<b>1</b> |" },
      ],
    },
  ],
};
