import {
  markConsumed,
  markExtRanges,
  scanRuns,
  type InlineSpan,
} from "../inline-parse.ts";
import type { FeatureSpec, InlineFeatureSpec } from "./_types.ts";

// em + strong are one feature under method-B because they share a single
// delim scanner per delim char: each pair resolves to strong (2 chars on
// each end) when possible, otherwise em (1 char).
//
// Both `*` and `_` emit em/strong. Underscore additionally requires a
// non-alphanumeric char on the outside of each run — so `foo_bar_baz`
// stays plain while `word _em_ word` fires. The two scans share the
// `consumed` bitmap; asterisk goes first because it is strictly looser.
//
// Stack-based L→R pairing (CommonMark style): unclosed open runs live
// on a stack; each run that canClose pops the nearest open run and
// pairs with it. Open delims are consumed from the LEFT of the run,
// close delims from the RIGHT — so `**1*` still pairs as em("*1") with
// outer `*`s as delims (the nearest open run on the stack IS the
// adjacent `**`). The old "leftmost open + rightmost close" scheme
// bridged independent groups across whitespace (e.g. `_em_ __strong__`
// became one big em span).

const isAlnum = (c: string): boolean => /[A-Za-z0-9]/.test(c);

function scanOneDelim(text: string, delim: string, consumed: Uint8Array, out: InlineSpan[]): void {
  const runs = scanRuns(text, delim, consumed);
  if (delim === "_") {
    for (const r of runs) {
      const before = r.pos > 0 ? text[r.pos - 1]! : " ";
      const after = r.pos + r.len < text.length ? text[r.pos + r.len]! : " ";
      if (isAlnum(before)) r.canOpen = false;
      if (isAlnum(after)) r.canClose = false;
    }
  }
  const stack: number[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    // Prefer close when both are possible and the stack has a candidate —
    // matches CommonMark "close first" for double-role runs like `*`.
    if (run.canClose && stack.length > 0) {
      const a = stack.pop()!;
      const open = runs[a]!;
      const close = run;

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
      out.push({
        type: wantLen === 2 ? "strong" : "em",
        from: innerFrom,
        to: innerTo,
        openFrom,
        openTo,
        closeFrom,
        closeTo,
      });
      continue;
    }
    if (run.canOpen) stack.push(i);
  }
}

const scan: InlineFeatureSpec["scan"] = (text, consumed) => {
  const out: InlineSpan[] = [];
  scanOneDelim(text, "*", consumed, out);
  scanOneDelim(text, "_", consumed, out);
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
    // `tok.markup` preserves the source delim char (`*` vs `_`) so that
    // round-trip keeps the user's original markdown verbatim.
    em_open: (state, tok, schema) => {
      state.addText(tok.markup);
      state.openMark(schema.marks.em.create());
    },
    em_close: (state, tok, schema) => {
      state.closeMarkType(schema.marks.em);
      state.addText(tok.markup);
    },
    strong_open: (state, tok, schema) => {
      state.addText(tok.markup);
      state.openMark(schema.marks.strong.create());
    },
    strong_close: (state, tok, schema) => {
      state.closeMarkType(schema.marks.strong);
      state.addText(tok.markup);
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
    {
      id: "underscores",
      label: "italic via single underscores",
      seed: "",
      events: ["_", "1", "_", " "],
      checkpoints: [
        { at: 1, expect: "_|" },
        { at: 2, expect: "_1|" },
        { at: 3, expect: "<g>_</g><i>1</i><g>_</g>|" },
        { at: 4, expect: "<i>1</i> |" },
      ],
    },
    {
      id: "double-underscores",
      label: "bold via double underscores",
      seed: "",
      events: ["_", "_", "1", "_", "_", " "],
      checkpoints: [
        { at: 2, expect: "__|" },
        { at: 3, expect: "__1|" },
        { at: 4, expect: "<g>_</g><i>_1</i><g>_</g>|" },
        { at: 5, expect: "<g>__</g><b>1</b><g>__</g>|" },
        { at: 6, expect: "<b>1</b> |" },
      ],
    },
    {
      id: "two-groups-underscore",
      label: "_em_ __strong__ — two independent underscore groups",
      seed: "",
      events: ["_","e","m","_"," ","_","_","s","t","r","o","n","g","_","_"," "],
      checkpoints: [
        { at: 16, expect: "<i>em</i> <b>strong</b> |" },
      ],
    },
    {
      id: "underscore-inside-word",
      label: "foo_bar_baz — underscore inside a word does not fire",
      seed: "",
      events: ["f", "o", "o", "_", "b", "a", "r", "_", "b", "a", "z"],
      checkpoints: [{ at: 11, expect: "foo_bar_baz|" }],
    },
  ],
};
