// Typora-flavoured inline parser — thin orchestration layer.
//
// Each inline feature contributes a `scan` function + priority. parseInline
// runs them in ascending priority order, threading a shared "consumed"
// bitmap so later scans see through to the non-claimed text.
//
// Shared utilities (scanRuns, scanFixedDelim, markConsumed) live here so
// features can compose common delim-run logic without reimplementing it.

import type { Node as PMNode } from "prosemirror-model";

import { collectInlineFeatures } from "./features/index.ts";

export type InlineSpan = {
  type: string; // mark name — filled by the scanning feature
  from: number;
  to: number;
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
};

export type Run = { pos: number; len: number; canOpen: boolean; canClose: boolean };

export function scanRuns(text: string, delim: string, consumed: Uint8Array): Run[] {
  const runs: Run[] = [];
  for (let i = 0; i < text.length; ) {
    if (text[i] !== delim || consumed[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && text[j] === delim && !consumed[j]) j++;
    const before = i > 0 ? text[i - 1]! : " ";
    const after = j < text.length ? text[j]! : " ";
    runs.push({
      pos: i,
      len: j - i,
      canOpen: !/\s/.test(after),
      canClose: !/\s/.test(before),
    });
    i = j;
  }
  return runs;
}

export function markConsumed(consumed: Uint8Array, from: number, to: number): void {
  for (let i = from; i < to; i++) consumed[i] = 1;
}

// Fixed-length delim helper (code len 1, strike len 2).
// Content must not contain the delim char itself — pilot simplification.
export function scanFixedDelim(
  text: string,
  delimCh: string,
  delimLen: number,
  type: string,
  consumed: Uint8Array,
): InlineSpan[] {
  const out: InlineSpan[] = [];
  const runs = scanRuns(text, delimCh, consumed).filter((r) => r.len >= delimLen);
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

    const openFrom = open.pos;
    const openTo = openFrom + delimLen;
    const closeTo = close.pos + close.len;
    const closeFrom = closeTo - delimLen;
    const innerFrom = openTo;
    const innerTo = closeFrom;
    if (innerFrom >= innerTo) continue;
    if (/\s/.test(text[innerFrom]!) || /\s/.test(text[innerTo - 1]!)) continue;

    let hasDelimInside = false;
    for (let k = innerFrom; k < innerTo; k++) {
      if (text[k] === delimCh) {
        hasDelimInside = true;
        break;
      }
    }
    if (hasDelimInside) continue;

    markConsumed(consumed, openFrom, closeTo);
    used.add(a);
    used.add(b);
    out.push({ type, from: innerFrom, to: innerTo, openFrom, openTo, closeFrom, closeTo });
  }
  return out;
}

// For serializer extRanges: find contiguous runs of a named mark over a
// textblock's children and extend each run by `openLen`/`closeLen` chars
// on the two sides (so the delim chars adjacent to the mark content fall
// inside the returned range and escape the serializer's backslash escape).
export function markExtRanges(
  parent: PMNode,
  markName: string,
  openLen: number,
  closeLen: number = openLen,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const markType = parent.type.schema.marks[markName];
  if (!markType) return ranges;
  let start = -1;
  let off = 0;
  parent.forEach((child) => {
    if (child.isText) {
      const has = child.marks.some((m) => m.type === markType);
      if (has && start < 0) start = off;
      if (!has && start >= 0) {
        ranges.push([start - openLen, off + closeLen]);
        start = -1;
      }
    }
    off += child.nodeSize;
  });
  if (start >= 0) ranges.push([start - openLen, off + closeLen]);
  return ranges;
}

// Orchestration.
export function parseInline(text: string): InlineSpan[] {
  const out: InlineSpan[] = [];
  const consumed = new Uint8Array(text.length);
  for (const f of collectInlineFeatures()) {
    for (const s of f.scan(text, consumed)) out.push(s);
  }
  return out;
}
