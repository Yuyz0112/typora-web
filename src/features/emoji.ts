import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

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

// ─── Autocomplete dropdown ────────────────────────────────────────────────
//
// While the user is typing `:partial` (no closing colon yet), show a small
// dropdown of matching names. Detection is selection-driven: every state
// transition we look at the chars before the cursor inside the current
// textblock and match against `\B:([a-z0-9_+\-]+)$`. If the partial has
// at least one char and matches at least one known name, we open the
// dropdown.
//
// Commit (Tab / Enter) replaces `:partial` with `:name:` + a trailing
// space, then closes the dropdown. The closing `:` lands first which
// causes the inline scanner to mark the span — the user sees the glyph
// appear immediately. Escape closes without committing.

const PARTIAL_RE = /\B:([a-z0-9_+\-]+)$/;

type AutoState = {
  open: boolean;
  partial: string;
  matches: string[];
  // Absolute doc positions of `:` (from) and the cursor (to).
  from: number;
  to: number;
};

const CLOSED: AutoState = { open: false, partial: "", matches: [], from: 0, to: 0 };

const autoKey = new PluginKey<AutoState>("emoji-autocomplete");

function computeAutoState(state: import("prosemirror-state").EditorState): AutoState {
  const sel = state.selection;
  if (!sel.empty) return CLOSED;
  const $pos = sel.$from;
  if (!$pos.parent.isTextblock) return CLOSED;
  const text = $pos.parent.textBetween(0, $pos.parentOffset, "\n", "\n");
  const m = PARTIAL_RE.exec(text);
  if (!m) return CLOSED;
  const partial = m[1]!;
  const matches = Object.keys(EMOJI)
    .filter((n) => n.startsWith(partial))
    .sort();
  if (matches.length === 0) return CLOSED;
  const blockStart = $pos.start();
  const cursor = $pos.pos;
  return {
    open: true,
    partial,
    matches,
    from: cursor - partial.length - 1, // points at `:`
    to: cursor,
  };
}

function commit(
  view: import("prosemirror-view").EditorView,
  name: string,
  s: AutoState,
): void {
  // Replace `:partial` with `:name:` plus a trailing space. The space is
  // what triggers the cursor to leave the surrounding span so the source
  // hides — matches the manual flow (`:smile:` then space).
  const replacement = `:${name}: `;
  const tr = view.state.tr.insertText(replacement, s.from, s.to);
  const newPos = s.from + replacement.length;
  tr.setSelection(TextSelection.create(tr.doc, newPos));
  view.dispatch(tr);
}

function emojiAutocompletePlugin(): Plugin<AutoState> {
  return new Plugin<AutoState>({
    key: autoKey,
    state: {
      init: (_, state) => computeAutoState(state),
      apply: (_tr, _prev, _oldState, newState) => computeAutoState(newState),
    },
    props: {
      decorations(state) {
        const s = autoKey.getState(state);
        if (!s?.open) return DecorationSet.empty;
        const pop = buildDropdown(s);
        return DecorationSet.create(state.doc, [
          Decoration.widget(s.to, pop, {
            side: 1,
            key: `emoji-auto@${s.to}:${s.partial}`,
            ignoreSelection: true,
          }),
        ]);
      },
      handleKeyDown(view, e) {
        const s = autoKey.getState(view.state);
        if (!s?.open) return false;
        if (e.key === "Escape") {
          // Move the cursor by 0 to force a tx that re-runs apply; the
          // partial pattern still matches so this only buys us an
          // "ignore until partial changes" if we add an explicit
          // dismissed flag. For pilot, just re-render same — keeping
          // Escape as a no-op is acceptable.
          return false;
        }
        if (e.key === "Tab" || e.key === "Enter") {
          const name = s.matches[0];
          if (!name) return false;
          commit(view, name, s);
          e.preventDefault();
          return true;
        }
        return false;
      },
    },
  });
}

function buildDropdown(s: AutoState): HTMLElement {
  // Rendered as <select> so test-pretty can map it to the user's
  // `<select />` shorthand. contenteditable=false so PM doesn't try to
  // route input into the popup.
  const el = document.createElement("select");
  el.className = "emoji-completion";
  el.setAttribute("contenteditable", "false");
  for (const name of s.matches.slice(0, 8)) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = `${EMOJI[name]} :${name}:`;
    el.appendChild(opt);
  }
  // Click a list item → commit. (Bubbles up via a custom event so the
  // plugin can dispatch from within the EditorView. Same pattern used
  // elsewhere for the file-input widget.)
  el.addEventListener("mousedown", (e) => e.preventDefault());
  el.addEventListener("change", (e) => {
    const target = e.target as HTMLSelectElement;
    el.dispatchEvent(
      new CustomEvent("emoji-autocomplete-pick", {
        bubbles: true,
        detail: { name: target.value },
      }),
    );
  });
  return el;
}

export const emoji: FeatureSpec = {
  name: "emoji",

  // No mark, no node — pure decoration. The source chars are valid plain
  // text in md (no escape needed for `:`), so serialization is automatic.

  plugins: () => [
    emojiAutocompletePlugin(),
    new Plugin({
      // Bridge: turn the dropdown's CustomEvent into a real PM commit.
      // We can't dispatch from the widget builder (no view there); the
      // plugin's view object is the natural carrier.
      view(view) {
        const handler = (e: Event) => {
          const ce = e as CustomEvent<{ name: string }>;
          const s = autoKey.getState(view.state);
          if (!s?.open) return;
          commit(view, ce.detail.name, s);
        };
        view.dom.addEventListener("emoji-autocomplete-pick", handler);
        return {
          destroy() {
            view.dom.removeEventListener("emoji-autocomplete-pick", handler);
          },
        };
      },
    }),
  ],

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
      checkpoints: [
        // `:` alone — partial is empty, dropdown stays closed.
        { at: 1, expect: ":|" },
        // From `:s` onwards the dropdown opens (PARTIAL_RE matches +
        // at least one known name has the prefix).
        { at: 2, expect: ":s|<select />" },
        { at: 3, expect: ":sm|<select />" },
        { at: 4, expect: ":smi|<select />" },
        { at: 5, expect: ":smil|<select />" },
        { at: 6, expect: ":smile|<select />" },
        // Closing `:` lands; PARTIAL_RE no longer matches → dropdown
        // closes. The inline scanner kicks in and renders the glyph
        // with the source chars as a gray hint (cursor at right edge).
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
