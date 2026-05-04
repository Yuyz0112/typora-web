import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorState } from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";

import { markConsumed, type InlineSpan } from "../inline-parse.ts";
import type { FeatureSpec, InlineFeatureSpec } from "./_types.ts";

import emojiData from "markdown-it-emoji/lib/data/full.mjs";

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

// Sourced from markdown-it-emoji's full registry (~1500 GitHub-style
// names). Kept as a typed Record for the rest of the file.
const EMOJI = emojiData as Record<string, string>;
const ALL_NAMES = Object.keys(EMOJI).sort();

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
          // `len` carries the `:name:` source length so a click on the
          // glyph can place the cursor at the span's tail rather than
          // the head (PM's default for a widget at side=-1).
          attrs: { glyph, len: String(fullEnd - fullStart) },
          side: -1,
        },
      ],
    });
  }
  return out;
};

// ─── Autocomplete dropdown ────────────────────────────────────────────────
//
// While the user is typing `:partial` (no closing colon yet), open a
// floating list of matching names. Detection is selection-driven: every
// state transition we look at the chars before the cursor inside the
// current textblock and match `\B:[a-z0-9_+\-]+$`. If at least one known
// name starts with the partial, the dropdown opens.
//
// The popup is a Decoration.widget at the cursor position so it lives
// in the same DOM tree (test-pretty can see it). Visually it's
// `position: absolute` and gets placed below the cursor by the plugin's
// view-update hook (`view.coordsAtPos` → editor-relative top/left).
//
// Selected index is plugin state. Up/Down move it, Enter/Tab commit,
// Escape closes. Click on a row commits its name. The committed text is
// `:name: ` (trailing space) — the closing colon trips the inline
// scanner, the space pushes the cursor past the span so the source hides.

const PARTIAL_RE = /\B:([a-z0-9_+\-]+)$/;
const MAX_VISIBLE = 8;

type AutoState = {
  open: boolean;
  partial: string;
  matches: string[];
  selected: number;
  // dismissed: user pressed Escape — keep popup closed until partial
  // changes (text edit) or the cursor leaves the partial region.
  dismissedFor: string;
  // Absolute doc positions of `:` (from) and the cursor (to).
  from: number;
  to: number;
};

const CLOSED: AutoState = {
  open: false,
  partial: "",
  matches: [],
  selected: 0,
  dismissedFor: "",
  from: 0,
  to: 0,
};

const autoKey = new PluginKey<AutoState>("emoji-autocomplete");

type AutoMeta =
  | { type: "select"; index: number }
  | { type: "dismiss" };

function findMatches(partial: string): string[] {
  // Two-pass score: prefix matches first (alphabetical), then substring
  // matches. Cap at MAX_VISIBLE so the popup stays small.
  const out: string[] = [];
  for (const n of ALL_NAMES) {
    if (n.startsWith(partial)) out.push(n);
    if (out.length >= MAX_VISIBLE) return out;
  }
  if (out.length < MAX_VISIBLE) {
    for (const n of ALL_NAMES) {
      if (out.includes(n)) continue;
      if (n.includes(partial)) out.push(n);
      if (out.length >= MAX_VISIBLE) break;
    }
  }
  return out;
}

function computeAutoState(state: EditorState, prev: AutoState): AutoState {
  const sel = state.selection;
  if (!sel.empty) return CLOSED;
  const $pos = sel.$from;
  if (!$pos.parent.isTextblock) return CLOSED;
  const text = $pos.parent.textBetween(0, $pos.parentOffset, "\n", "\n");
  const m = PARTIAL_RE.exec(text);
  if (!m) return CLOSED;
  const partial = m[1]!;
  // Suppress the popup if the user dismissed it for this exact partial.
  if (prev.dismissedFor === partial) {
    return { ...CLOSED, dismissedFor: partial };
  }
  const matches = findMatches(partial);
  if (matches.length === 0) return CLOSED;
  const cursor = $pos.pos;
  // Preserve selected index when partial unchanged and selected still in
  // range; otherwise reset to 0.
  const sameSearch =
    prev.open && prev.partial === partial && prev.matches.length === matches.length;
  const selected = sameSearch ? Math.min(prev.selected, matches.length - 1) : 0;
  return {
    open: true,
    partial,
    matches,
    selected,
    dismissedFor: "",
    from: cursor - partial.length - 1, // points at `:`
    to: cursor,
  };
}

function commit(view: EditorView, name: string, s: AutoState): void {
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
      init: (_, state) => computeAutoState(state, CLOSED),
      apply(tr, prev, _oldState, newState) {
        const meta = tr.getMeta(autoKey) as AutoMeta | undefined;
        if (meta?.type === "select") {
          if (!prev.open) return prev;
          const max = prev.matches.length - 1;
          const next = Math.max(0, Math.min(max, meta.index));
          return { ...prev, selected: next };
        }
        if (meta?.type === "dismiss") {
          return { ...CLOSED, dismissedFor: prev.partial };
        }
        return computeAutoState(newState, prev);
      },
    },
    props: {
      decorations(state) {
        const s = autoKey.getState(state);
        if (!s?.open) return DecorationSet.empty;
        // Re-create the widget DOM only when the rendered shape would
        // change — `key` lets PM dedupe across transactions.
        const el = buildDropdown(s);
        return DecorationSet.create(state.doc, [
          Decoration.widget(s.to, el, {
            side: 1,
            key: `emoji-auto@${s.partial}@${s.selected}`,
            ignoreSelection: true,
            stopEvent: () => true,
          }),
        ]);
      },
      handleKeyDown(view, e) {
        const s = autoKey.getState(view.state);
        if (!s?.open) return false;
        if (e.key === "ArrowDown") {
          view.dispatch(
            view.state.tr.setMeta(autoKey, { type: "select", index: s.selected + 1 } as AutoMeta),
          );
          e.preventDefault();
          return true;
        }
        if (e.key === "ArrowUp") {
          view.dispatch(
            view.state.tr.setMeta(autoKey, { type: "select", index: s.selected - 1 } as AutoMeta),
          );
          e.preventDefault();
          return true;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          const name = s.matches[s.selected];
          if (!name) return false;
          commit(view, name, s);
          e.preventDefault();
          return true;
        }
        if (e.key === "Escape") {
          view.dispatch(view.state.tr.setMeta(autoKey, { type: "dismiss" } as AutoMeta));
          e.preventDefault();
          return true;
        }
        return false;
      },
    },
    // Position the popup below the cursor after every update. We use
    // `position: fixed` (viewport coords) so the offset-parent dance
    // doesn't matter — `coordsAtPos` returns viewport coords directly.
    view(view) {
      const reposition = () => {
        const s = autoKey.getState(view.state);
        if (!s?.open) return;
        const el = view.dom.querySelector<HTMLElement>(".emoji-completion");
        if (!el) return;
        // side=-1: anchor to the *right edge of the previous char* rather
        // than "after the position". With the default (side=1), a cursor
        // at the end of a textblock falls through to the textblock's
        // bottom boundary — for our editor (min-height 168px) that's far
        // below the actual line, putting the popup at the bottom of the
        // empty editor area instead of below the cursor.
        const coords = view.coordsAtPos(s.to, -1);
        el.style.top = `${coords.bottom + 2}px`;
        el.style.left = `${coords.left}px`;
        // Keep the selected row visible by scrolling the popup itself
        // (NOT scrollIntoView — that would walk up to scroll the page).
        const sel = el.querySelector<HTMLElement>(".emoji-completion-row.selected");
        if (sel) {
          const elRect = el.getBoundingClientRect();
          const selRect = sel.getBoundingClientRect();
          if (selRect.top < elRect.top) {
            el.scrollTop -= elRect.top - selRect.top;
          } else if (selRect.bottom > elRect.bottom) {
            el.scrollTop += selRect.bottom - elRect.bottom;
          }
        }
      };
      reposition();
      return {
        update() {
          reposition();
        },
      };
    },
  });
}

function buildDropdown(s: AutoState): HTMLElement {
  const root = document.createElement("div");
  root.className = "emoji-completion";
  root.setAttribute("contenteditable", "false");
  // Stop PM from treating clicks/mousedowns as editor input — without
  // this the editor steals focus before our click handler fires.
  root.addEventListener("mousedown", (e) => e.preventDefault());
  for (let i = 0; i < s.matches.length; i++) {
    const name = s.matches[i]!;
    const row = document.createElement("div");
    row.className = "emoji-completion-row";
    if (i === s.selected) row.classList.add("selected");
    row.dataset.name = name;
    const glyph = document.createElement("span");
    glyph.className = "emoji-completion-glyph";
    glyph.textContent = EMOJI[name] ?? "";
    const label = document.createElement("span");
    label.className = "emoji-completion-name";
    label.textContent = `:${name}:`;
    row.appendChild(glyph);
    row.appendChild(label);
    row.addEventListener("click", () => {
      root.dispatchEvent(
        new CustomEvent("emoji-autocomplete-pick", {
          bubbles: true,
          detail: { name },
        }),
      );
    });
    root.appendChild(row);
  }
  return root;
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
    // Clicking the rendered glyph drops the caret at the *tail* of the
    // `:name:` source rather than the head. PM's default for a widget
    // at side=-1 puts the cursor right before the widget, which lands
    // visually outside the emoji span — the source chars are hidden and
    // the user thinks the click did nothing.
    new Plugin({
      props: {
        handleClick(view, _pos, event) {
          const target = event.target as HTMLElement | null;
          const glyph = target?.closest(".emoji-glyph") as HTMLElement | null;
          if (!glyph) return false;
          const len = Number(glyph.getAttribute("data-len") ?? "0");
          if (!len) return false;
          const widgetPos = view.posAtDOM(glyph, 0);
          if (widgetPos < 0) return false;
          const tail = widgetPos + len;
          if (tail > view.state.doc.content.size) return false;
          event.preventDefault();
          view.dispatch(
            view.state.tr.setSelection(TextSelection.create(view.state.doc, tail)),
          );
          view.focus();
          return true;
        },
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

};
