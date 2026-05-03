import { markConsumed, type InlineSpan } from "../inline-parse.ts";
import type { FeatureSpec, InlineFeatureSpec } from "./_types.ts";

// CommonMark autolink: `<scheme:rest>` and `<email>`. Method-B mode —
// text keeps `<` and `>` verbatim; the inline scanner derives the mark
// when content matches a scheme-bearing URI or simplified email.
//
// We disable md-it's built-in autolink rule (mdItPlugins below). When
// a source document is parsed, `<https://x.com>` flows through as plain
// text (md-it has no other rule that swallows it once autolink + html
// are off), then normalize re-derives the mark on the next transaction.
//
// `<a>` tag rendering is handled by link.ts's renderCase (single owner
// for the tag). Autolink toDOM emits `data-autolink` so the dispatch
// can split <l:url> vs <a:url>.

// scheme-bearing URI: ASCII alpha + alphanums/.+- before `:`, then any
// non-space, non-`<>` chars. RFC 3986 is more strict but this is good
// enough for the pilot — markdown-it commonmark uses the same shape.
const URI_PART = "[a-zA-Z][a-zA-Z0-9+.-]*:[^\\s<>]+";
const EMAIL_PART =
  "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}";
const AUTOLINK_RE = new RegExp(`<((?:${URI_PART})|(?:${EMAIL_PART}))>`, "g");

const scan: InlineFeatureSpec["scan"] = (text, consumed) => {
  const out: InlineSpan[] = [];
  AUTOLINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AUTOLINK_RE.exec(text))) {
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
    const inner = m[1]!;
    const isEmail = !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(inner);
    const href = isEmail ? `mailto:${inner}` : inner;
    markConsumed(consumed, fullStart, fullEnd);
    out.push({
      type: "autolink",
      from: fullStart + 1, // after `<`
      to: fullEnd - 1,     // before `>`
      openFrom: fullStart,
      openTo: fullStart + 1,
      closeFrom: fullEnd - 1,
      closeTo: fullEnd,
      attrs: { href },
    });
  }
  return out;
};

export const autolink: FeatureSpec = {
  name: "autolink",

  marks: {
    autolink: {
      attrs: { href: {} },
      inclusive: false,
      parseDOM: [
        {
          tag: "a[data-autolink]",
          getAttrs: (el) => ({
            href: (el as HTMLElement).getAttribute("href") ?? "",
          }),
        },
      ],
      toDOM: (mark) => [
        "a",
        { href: mark.attrs.href as string, "data-autolink": "" },
        0,
      ],
    },
  },

  // CommonMark md-it would parse `<url>` as a `link_open`/`link_close` pair
  // with markup="autolink", which the link feature would then materialise as
  // a regular `[url](url)` link. Disable so the source flows through as text
  // and the inline scanner above is the single source of truth.
  mdItPlugins: [(md) => md.disable("autolink")],

  markDelims: {
    autolink: { open: "", close: "" },
  },

  // No renderCase here — link.ts owns the `<a>` tag mapping and dispatches
  // on `data-autolink` to emit `<a:url>...</a>` for autolink and
  // `<l:url>...</l>` for regular links.

  inline: {
    priority: 2.5, // before link (3); the `<...>` shape doesn't conflict with `[...](...)` anyway
    scan,
    markNames: ["autolink"],
    extRanges: (parent) => {
      // Same shape as link's extRanges but for the autolink mark: cover
      // the `<` open delim and `>` close delim plus the URI content.
      const ranges: Array<[number, number]> = [];
      const autolinkType = parent.type.schema.marks.autolink;
      if (!autolinkType) return ranges;
      let start = -1;
      let off = 0;
      const flush = (end: number): void => {
        if (start < 0) return;
        ranges.push([start - 1, end + 1]); // -1 for `<`, +1 for `>`
        start = -1;
      };
      parent.forEach((child) => {
        if (child.isText) {
          const has = child.marks.some((mk) => mk.type === autolinkType);
          if (has) {
            if (start < 0) start = off;
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
