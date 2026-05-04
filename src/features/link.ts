import type { Mark } from "prosemirror-model";

import { markConsumed, type InlineSpan } from "../inline-parse.ts";
import type { FeatureSpec, InlineFeatureSpec } from "./_types.ts";

// link in Typora-pilot (method B) mode.
//
// The source `[text](href "title")` lives verbatim in the textblock text:
//   open delim  = `[`             (1 char)
//   content     = text            (link mark covers this range)
//   close delim = `](href "title")` or `](href)`  (length depends on attrs)
//
// parseInline uses a regex — unlike the delim-run emphasis/code/strike
// path — because the close delim is asymmetric and carries data. Nested
// brackets inside content and escaped `]` are not handled yet (pilot).

const LINK_RE = /\[([^\]]*?)\]\(([^\s)]*)(?:\s+"([^"]*)")?\)/g;

const scan: InlineFeatureSpec["scan"] = (text, consumed) => {
  const out: InlineSpan[] = [];
  LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(text))) {
    const fullStart = m.index;
    const fullEnd = fullStart + m[0].length;
    const openFrom = fullStart;
    const openTo = fullStart + 1; // after `[`
    const contentFrom = openTo;
    const contentTo = openTo + m[1]!.length;
    const closeFrom = contentTo;
    const closeTo = fullEnd;

    // Only the chrome (`[` and `](url "title")`) needs to be unclaimed.
    // The text portion may legitimately overlap with code / em / strong /
    // emoji etc. — those nest inside link text and must keep their
    // marks. Bail only when something else has consumed a chrome char.
    let blocked = false;
    for (let i = openFrom; i < openTo; i++) {
      if (consumed[i]) { blocked = true; break; }
    }
    if (!blocked) {
      for (let i = closeFrom; i < closeTo; i++) {
        if (consumed[i]) { blocked = true; break; }
      }
    }
    if (blocked) continue;

    // Claim chrome only; leave the text-portion bitmap untouched so
    // any earlier feature's spans there stay live.
    markConsumed(consumed, openFrom, openTo);
    markConsumed(consumed, closeFrom, closeTo);
    const href = m[2]!;
    const title = m[3] ?? null;
    const span: InlineSpan = {
      type: "link",
      from: contentFrom,
      to: contentTo,
      openFrom,
      openTo,
      closeFrom,
      closeTo,
      attrs: { href, title },
    };
    // Empty link text would render as nothing if delims hid normally —
    // override the delim layout so the link stays visible/editable.
    if (m[1] === "") {
      if (href === "" || title !== null) {
        // [](): both delims forced visible. With a title we also fall
        // back to whole-close-delim visibility (no href promotion yet).
        span.delimRanges = [
          { from: openFrom, to: openTo, forceVisible: true },
          { from: closeFrom, to: closeTo, forceVisible: true },
        ];
      } else {
        // [](url): split close delim around href so the url shows as
        // link-styled visible text (mirrors autolink form).
        const hrefStart = closeFrom + 2; // after `](`
        const hrefEnd = closeTo - 1;     // before `)`
        span.delimRanges = [
          { from: openFrom, to: openTo, forceVisible: true },
          { from: closeFrom, to: hrefStart, forceVisible: true },
          { from: hrefEnd, to: closeTo, forceVisible: true },
        ];
        span.extraDecorations = [
          { from: hrefStart, to: hrefEnd, nodeName: "a", attrs: { href } },
        ];
      }
    }
    out.push(span);
  }
  return out;
};

function closeDelimText(mark: Mark): string {
  const href = String(mark.attrs.href ?? "");
  const title = mark.attrs.title as string | null;
  return title
    ? `](${href} "${title.replace(/"/g, '\\"')}")`
    : `](${href})`;
}

export const link: FeatureSpec = {
  name: "link",

  marks: {
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
  },

  parserTokens: {
    link_open: (state, tok, schema) => {
      const href = tok.attrGet("href") ?? "";
      const title = tok.attrGet("title");
      state.addText("[");
      state.openMark(schema.marks.link.create({ href, title: title || null }));
    },
    link_close: (state, _tok, schema) => {
      const mark = state.topMark(schema.marks.link);
      state.closeMarkType(schema.marks.link);
      if (mark) state.addText(closeDelimText(mark));
    },
  },

  markDelims: {
    link: { open: "", close: "" },
  },

  inline: {
    // After emphasis/code/strike — link syntax `[`/`]`/`(` doesn't overlap
    // with *,`,~ anyway, but keeping priority highest (last) means a line
    // like `*[a](b)*` first claims the em pair and leaves link to pick up
    // the inner text.
    priority: 3,
    scan,
    markNames: ["link"],
    extRanges: (parent) => {
      const ranges: Array<[number, number]> = [];
      const linkType = parent.type.schema.marks.link;
      if (!linkType) return ranges;
      let start = -1;
      let currentMark: Mark | null = null;
      let off = 0;
      const flush = (end: number): void => {
        if (start < 0 || !currentMark) return;
        ranges.push([start - 1, end + closeDelimText(currentMark).length]);
        start = -1;
        currentMark = null;
      };
      parent.forEach((child) => {
        if (child.isText) {
          const m = child.marks.find((mk) => mk.type === linkType) ?? null;
          if (m) {
            if (start < 0) {
              start = off;
              currentMark = m;
            } else if (currentMark && !m.eq(currentMark)) {
              flush(off);
              start = off;
              currentMark = m;
            }
          } else {
            flush(off);
          }
        }
        off += child.nodeSize;
      });
      flush(off);
      return ranges;
    },
  },

};
