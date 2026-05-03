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

      // ***x*** form: both runs ≥ 3 chars → emit em outer + strong inner
      // in one shot. Matches CommonMark example 466 (`***foo***` →
      // `<em><strong>foo</strong></em>`). Only this exact configuration
      // triggers nesting; other run-length combos keep the single-pair
      // behaviour to avoid drifting into harder rule-of-three territory.
      if (open.len >= 3 && close.len >= 3) {
        const emOpenFrom = open.pos;
        const emOpenTo = emOpenFrom + 1;
        const emCloseTo = close.pos + close.len;
        const emCloseFrom = emCloseTo - 1;
        const strongOpenFrom = emOpenTo;
        const strongOpenTo = strongOpenFrom + 2;
        const strongCloseTo = emCloseFrom;
        const strongCloseFrom = strongCloseTo - 2;
        const innerFrom = strongOpenTo;
        const innerTo = strongCloseFrom;
        if (innerFrom >= innerTo) continue;
        if (/\s/.test(text[innerFrom]!) || /\s/.test(text[innerTo - 1]!)) continue;

        markConsumed(consumed, emOpenFrom, emCloseTo);
        out.push({
          type: "em",
          from: emOpenTo,
          to: emCloseFrom,
          openFrom: emOpenFrom,
          openTo: emOpenTo,
          closeFrom: emCloseFrom,
          closeTo: emCloseTo,
        });
        out.push({
          type: "strong",
          from: innerFrom,
          to: innerTo,
          openFrom: strongOpenFrom,
          openTo: strongOpenTo,
          closeFrom: strongCloseFrom,
          closeTo: strongCloseTo,
        });
        continue;
      }

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

  inline: {
    priority: 2,
    scan,
    markNames: ["em", "strong"],
    extRanges: (parent) => [
      ...markExtRanges(parent, "em", 1),
      ...markExtRanges(parent, "strong", 2),
    ],
  },

};
