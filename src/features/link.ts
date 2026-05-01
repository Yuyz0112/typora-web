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
        // at 4: auto-pair on `(` puts `)` in place. Empty href `[a]()`
        // is now a valid link (regex allows empty href), so the link
        // fires immediately; cursor splits the close-delim gray span.
        { at: 4, expect: "<g>[</g><l:>a</l><g>](</g>|<g>)</g>" },
        // at 5: typing `b` completes `[a](b)` so the link fires; cursor
        // sits between `b` and the close `)`.
        { at: 5, expect: "<g>[</g><l:b>a</l><g>](b</g>|<g>)</g>" },
        // at 6: skip-over moves cursor past `)`; link span unchanged.
        { at: 6, expect: "<g>[</g><l:b>a</l><g>](b)</g>|" },
        // at 7: space pushes cursor past span → delims hidden.
        { at: 7, expect: "<l:b>a</l> |" },
      ],
    },
    {
      id: "empty-href",
      label: "[a]() — empty href is a valid link",
      seed: "",
      events: ["[", "a", "]", "(", ")"],
      checkpoints: [
        { at: 3, expect: "[a]|" },
        { at: 4, expect: "<g>[</g><l:>a</l><g>](</g>|<g>)</g>" },
        // at 5: skip-over moves cursor past `)`; cursor sits at span's
        // right edge so delims stay visible (same as inline-link at:6).
        { at: 5, expect: "<g>[</g><l:>a</l><g>]()</g>|" },
      ],
    },
    {
      id: "href-with-query",
      label: "[a](http://x.com/p?q=1&r=2) — query chars survive in href",
      seed: "[a](http://x.com/p?q=1&r=2) ",
      events: [],
      checkpoints: [
        { at: 0, expect: "<l:http://x.com/p?q=1&r=2>a</l> |" },
      ],
    },
    {
      id: "empty-link-stable",
      label: "[]() stable — empty text keeps delims visible",
      seed: "[]() ",
      events: [],
      checkpoints: [
        // cursor parked at end (after trailing space, outside span).
        // Empty text means delims stay gray instead of hiding, otherwise
        // the link would be invisible/uneditable.
        { at: 0, expect: "<g>[</g><g>]()</g> |" },
      ],
    },
    {
      id: "empty-text-only-href-stable",
      label: "[](url) stable — empty text promotes url to visible link text",
      seed: "[](http://x.com) ",
      events: [],
      checkpoints: [
        // text empty: `[`, `](`, `)` stay gray; href text inside the
        // close delim renders with link style, mirroring autolink form.
        {
          at: 0,
          expect:
            "<g>[</g><g>](</g><l:http://x.com>http://x.com</l><g>)</g> |",
        },
      ],
    },
    {
      id: "empty-link",
      label: "[]() — empty text + empty href, all chars are delim",
      seed: "",
      events: ["[", "]", "("],
      checkpoints: [
        { at: 1, expect: "[|]" },
        { at: 2, expect: "[]|" },
        // at 3: doc is `[]()`, link mark covers all 4 chars (all delim).
        // open delim `[` and close delim `](...)` are emitted as separate
        // decorations (content is empty between them); cursor between `(`
        // and `)` splits the close-delim span.
        { at: 3, expect: "<g>[</g><g>](</g>|<g>)</g>" },
      ],
    },
  ],
};
