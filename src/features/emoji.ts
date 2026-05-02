import { markConsumed, type InlineSpan } from "../inline-parse.ts";
import type { FeatureSpec, InlineFeatureSpec } from "./_types.ts";

// Emoji `:name:` — Typora-style. The source `:name:` lives verbatim in
// the textblock text (so md round-trip is automatic). A widget decoration
// renders the unicode glyph just *before* the source span, and the source
// chars themselves get a delim range that hides them when the cursor is
// outside the span (gray when inside — same convention as image / link
// delim hints).
//
// Pretty:
//   :smile|             — pre-close, plain typing, no widget yet
//   😄<g>:smile:</g>|   — closing colon lands; cursor inside surrounding span
//   😄 |                — cursor moved past, source hidden, glyph stays

// Hand-curated subset; the registry is just a Record so new names are
// one-line additions. Full lists (`markdown-it-emoji`) can be wired in
// later if we ever need thousands of names.
const EMOJI: Record<string, string> = {
  smile: "😄",
  joy: "😂",
  cry: "😢",
  cool: "😎",
  thinking: "🤔",
  eyes: "👀",
  heart: "❤️",
  fire: "🔥",
  tada: "🎉",
  rocket: "🚀",
  bug: "🐛",
  warning: "⚠️",
  sparkles: "✨",
  white_check_mark: "✅",
  x: "❌",
  "+1": "👍",
  "-1": "👎",
};

// :name: where name is alphanum + a few safe punct chars. Lazy match so
// `:a:b:` resolves to `:a:` followed by stray `:b:` rather than spanning.
const EMOJI_RE = /:([a-z0-9_+\-]+):/g;

const scan: InlineFeatureSpec["scan"] = (text, consumed) => {
  const out: InlineSpan[] = [];
  EMOJI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMOJI_RE.exec(text))) {
    const name = m[1]!;
    const glyph = EMOJI[name];
    if (!glyph) continue; // unknown name → leave as plain text
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
    markConsumed(consumed, fullStart, fullEnd);
    out.push({
      type: "emoji",
      from: fullStart,
      to: fullEnd,
      openFrom: fullStart,
      openTo: fullStart,
      closeFrom: fullEnd,
      closeTo: fullEnd,
      // Whole `:name:` becomes one delim range — hidden when cursor is
      // outside the span, gray hint when inside (default behavior).
      delimRanges: [{ from: fullStart, to: fullEnd }],
      // Glyph widget at the span's start, side=-1 so it renders just
      // before the (possibly-hidden) source chars. when="always" — the
      // glyph is the one piece that shouldn't disappear when the user
      // navigates onto the source for editing.
      widgetDecorations: [
        {
          pos: fullStart,
          when: "always",
          kind: "emoji",
          attrs: { glyph },
          side: -1,
        },
      ],
    });
  }
  return out;
};

export const emoji: FeatureSpec = {
  name: "emoji",

  // No mark, no node — pure decoration. The source chars are valid plain
  // text in md (no escape needed for `:`), so serialization is automatic.

  inline: {
    // Run early — emoji name chars don't conflict with anything else, but
    // a low priority means later features see the chars as already-consumed
    // and don't try to claim them.
    priority: 0.7,
    scan,
    markNames: [],
    extRanges: () => [],
  },

  cases: [
    {
      id: "type-smile",
      label: ":smile: typed char by char — emoji renders on closing `:`",
      seed: "",
      events: [":", "s", "m", "i", "l", "e", ":", " "],
      // Autocomplete dropdown (per spec) deferred — these checkpoints
      // assert just the rendering side.
      checkpoints: [
        { at: 1, expect: ":|" },
        { at: 2, expect: ":s|" },
        { at: 3, expect: ":sm|" },
        { at: 4, expect: ":smi|" },
        { at: 5, expect: ":smil|" },
        { at: 6, expect: ":smile|" },
        { at: 7, expect: "😄<g>:smile:</g>|" },
        { at: 8, expect: "😄 |" },
      ],
    },
    {
      id: "unknown-name-stays-text",
      label: ":notarealname: — unknown name stays as plain text",
      seed: ":notarealname: ",
      events: [],
      checkpoints: [
        { at: 0, expect: ":notarealname: |" },
      ],
    },
    {
      id: "parse-from-seed",
      label: "<seed> :rocket: ships → renders glyph, source hidden (cursor at end)",
      seed: ":rocket: ships",
      events: [],
      checkpoints: [
        { at: 0, expect: "🚀 ships|" },
      ],
    },
  ],
};
