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

const LINK_RE = /\[([^\]]*?)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g;

const scan: InlineFeatureSpec["scan"] = (text, consumed) => {
  const out: InlineSpan[] = [];
  LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_RE.exec(text))) {
    const fullStart = m.index;
    const fullEnd = fullStart + m[0].length;
    let blocked = false;
    for (let i = fullStart; i < fullEnd; i++) {
      if (consumed[i]) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const openFrom = fullStart;
    const openTo = fullStart + 1; // after `[`
    const contentFrom = openTo;
    const contentTo = openTo + m[1]!.length;
    const closeFrom = contentTo;
    const closeTo = fullEnd;

    markConsumed(consumed, fullStart, fullEnd);
    out.push({
      type: "link",
      from: contentFrom,
      to: contentTo,
      openFrom,
      openTo,
      closeFrom,
      closeTo,
      attrs: { href: m[2]!, title: m[3] ?? null },
    });
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

  renderCases: {
    a: (children, el) => {
      const href = el.getAttribute("href") ?? "";
      return `<l:${href}>${children}</l>`;
    },
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

  cases: [
    {
      id: "inline-link",
      label: "[a](b) — link fires when the close `)` lands",
      seed: "",
      events: ["[", "a", "]", "(", "b", ")", " "],
      checkpoints: [
        { at: 3, expect: "[a]|" },
        { at: 5, expect: "[a](b|" },
        // at 6: full `[a](b)` present, normalize recognises link; cursor
        // is at span's right edge → delims visible.
        { at: 6, expect: "<g>[</g><l:b>a</l><g>](b)</g>|" },
        // at 7: space pushes cursor past span → delims hidden.
        { at: 7, expect: "<l:b>a</l> |" },
      ],
    },
  ],
};
