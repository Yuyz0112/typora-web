import { markConsumed, markExtRanges, type InlineSpan } from "../inline-parse.ts";
import type { FeatureSpec } from "./_types.ts";

// Variable-length backtick fence scanner.
//
// Pairing: prefer an exact-length close run when available; otherwise
// fall back to the first unused close run. The fence itself takes
// `min(open.len, close.len)` chars from each side; any leftover open-run
// chars become part of the content.
//
// Whitespace handling: inner content that begins or ends with whitespace
// has those whitespace chars excluded from the code mark and emitted as
// soft delim ranges instead — they render as plain text while the cursor
// is inside the span (so the user can edit them) and disappear when the
// cursor leaves (so the stable view shows only the code-styled content).
function scanCodeRuns(text: string, consumed: Uint8Array): InlineSpan[] {
  const out: InlineSpan[] = [];
  type Run = { pos: number; len: number };
  const runs: Run[] = [];
  for (let i = 0; i < text.length; ) {
    if (text[i] !== "`" || consumed[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && text[j] === "`" && !consumed[j]) j++;
    runs.push({ pos: i, len: j - i });
    i = j;
  }

  const used = new Set<number>();
  for (let a = 0; a < runs.length; a++) {
    if (used.has(a)) continue;
    const open = runs[a]!;
    if (consumed[open.pos]) {
      used.add(a);
      continue;
    }
    let b = -1;
    for (let k = a + 1; k < runs.length; k++) {
      if (used.has(k) || consumed[runs[k]!.pos]) continue;
      if (runs[k]!.len === open.len) {
        b = k;
        break;
      }
    }
    if (b === -1) {
      for (let k = a + 1; k < runs.length; k++) {
        if (used.has(k) || consumed[runs[k]!.pos]) continue;
        b = k;
        break;
      }
    }
    if (b === -1) continue;
    const close = runs[b]!;

    const fenceLen = Math.min(open.len, close.len);
    const openFrom = open.pos;
    const openTo = openFrom + fenceLen;
    const closeTo = close.pos + close.len;
    const closeFrom = closeTo - fenceLen;
    if (openTo >= closeFrom) continue;

    const innerStart = openTo;
    const innerEnd = closeFrom;
    if (!/\S/.test(text.slice(innerStart, innerEnd))) continue;

    let markFrom = innerStart;
    let markTo = innerEnd;
    while (markFrom < markTo && /\s/.test(text[markFrom]!)) markFrom += 1;
    while (markTo > markFrom && /\s/.test(text[markTo - 1]!)) markTo -= 1;

    const hasSoft = markFrom > innerStart || markTo < innerEnd;
    let delimRanges: InlineSpan["delimRanges"];
    if (hasSoft) {
      delimRanges = [{ from: openFrom, to: openTo }];
      if (markFrom > innerStart) {
        delimRanges.push({ from: innerStart, to: markFrom, softInside: true });
      }
      if (markTo < innerEnd) {
        delimRanges.push({ from: markTo, to: innerEnd, softInside: true });
      }
      delimRanges.push({ from: closeFrom, to: closeTo });
    }

    markConsumed(consumed, openFrom, closeTo);
    used.add(a);
    used.add(b);
    const span: InlineSpan = {
      type: "code",
      from: markFrom,
      to: markTo,
      openFrom,
      openTo,
      closeFrom,
      closeTo,
    };
    if (delimRanges) span.delimRanges = delimRanges;
    out.push(span);
  }
  return out;
}

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
      // tok.markup is the actual fence (e.g. `` ` ``, `` `` ``, `` ``` ``).
      // For multi-char fences, CommonMark renders content with a single
      // leading + trailing space stripped if present on both sides; we
      // need to put those spaces back so the doc carries the verbatim
      // source. md-it doesn't expose the original spaces directly, but
      // we can detect the case: any fence longer than 1 char that wraps
      // content containing the same fence char needs the surrounding
      // space to disambiguate.
      const fence = tok.markup;
      let content = tok.content;
      if (fence.length > 1 && content.includes(fence[0]!)) {
        content = ` ${content} `;
      }
      state.addText(fence);
      state.openMark(schema.marks.code.create());
      state.addText(content);
      state.closeMarkType(schema.marks.code);
      state.addText(fence);
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
    scan: scanCodeRuns,
    markNames: ["code"],
    // For round-trip: ext-range covers the full source span — open run +
    // optional folded space + content + optional folded space + close run.
    // We can't know the original delim length from the doc alone, but we
    // can find each contiguous code-mark run and walk left/right past
    // backticks (and at most one adjacent space if both sides have one).
    extRanges: (parent) => {
      const ranges: Array<[number, number]> = [];
      const codeType = parent.type.schema.marks.code;
      if (!codeType) return ranges;
      const text = parent.textContent;
      // Use markExtRanges with delim length 0 to get raw mark ranges,
      // then expand each side past backticks (and optional fold-space).
      const baseRanges = markExtRanges(parent, "code", 0);
      for (const [from, to] of baseRanges) {
        let left = from;
        // Optional folded space immediately before the mark.
        if (left > 0 && text[left - 1] === " ") left -= 1;
        while (left > 0 && text[left - 1] === "`") left -= 1;
        let right = to;
        if (right < text.length && text[right] === " ") right += 1;
        while (right < text.length && text[right] === "`") right += 1;
        ranges.push([left, right]);
      }
      return ranges;
    },
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
    {
      id: "double-backtick-basic",
      label: "``x`` — double-backtick fence around plain content",
      seed: "",
      events: ["`", "`", "x", "`", "`", " "],
      checkpoints: [
        { at: 2, expect: "``|" },
        { at: 3, expect: "``x|" },
        // step 5: 2-backtick open + 2-backtick close → fence fires
        { at: 5, expect: "<g>``</g><c>x</c><g>``</g>|" },
        { at: 6, expect: "<c>x</c> |" },
      ],
    },
    {
      id: "double-backtick-embedded-backtick",
      label: "`` ` `` — double-backtick fence wrapping a single backtick",
      seed: "",
      events: ["`", "`", " ", "`", " ", "`", "`", " "],
      checkpoints: [
        { at: 1, expect: "`|" },
        { at: 2, expect: "``|" },
        { at: 3, expect: "`` |" },
        // step 4: a 1-char close lands. Even though the open run is 2-long,
        // Typora fires a 1-char fence using one of those backticks, leaving
        // the other as the code-marked content. The trailing space inside
        // is a soft range — visible while the cursor is inside the span.
        { at: 4, expect: "<g>`</g><c>`</c> <g>`</g>|" },
        // step 5: cursor moves past trailing space → outside span → delim
        // and soft space hidden, only the code-styled backtick + the
        // post-span trailing space remain.
        { at: 5, expect: "<c>`</c> |" },
        // step 6: another `   typed after the trailing space — outside the
        // existing 1-char fence, so it shows as plain text.
        { at: 6, expect: "<c>`</c> `|" },
        // step 7: the 2-char close run that finally lands re-pairs with the
        // 2-char open run as a 2-char fence; the leading + trailing space
        // are soft ranges inside the span (visible since cursor is inside).
        { at: 7, expect: "<g>``</g> <c>`</c> <g>``</g>|" },
        // step 8: cursor moves past the new trailing space → outside span
        // → soft + delim hidden.
        { at: 8, expect: "<c>`</c> |" },
      ],
    },
  ],
};
