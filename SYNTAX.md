# Syntax compatibility

Tracks which Markdown / Typora syntaxes are supported in typora-web.

Status legend:
- ✅ — implemented, round-trip stable, has tests
- 🟡 — partial: covers common shape, edge cases pending (see notes)
- ⏸️ — deliberately deferred (decision recorded in notes)
- ❌ — not implemented

## CommonMark — block

| Syntax | Status | Feature | Notes |
|---|---|---|---|
| paragraph | ✅ | core | trailing-space preserved (md-it paragraph rule replaced) |
| ATX heading `#`..`######` | ✅ | `heading` | |
| setext heading (`===` / `---` underline) | ✅ | `heading` | parser-only (Typora doesn't auto-convert); `style` attr preserves shape across round-trip; output uses canonical 3-char underline |
| blockquote `>` | ✅ | `blockquote` | |
| bullet list `-` / `*` / `+` | ✅ | `list` | tight/loose distinction not asserted |
| ordered list `1.` | ✅ | `list` | |
| nested list | ✅ | `list` | 3-step staircase exit (Typora-style) |
| task list `- [ ]` / `- [x]` | ✅ | `task` | checkbox widget replaces `[ ] ` source; cursor-trapped (can't navigate into hidden marker); click toggles. round-trip stable. |
| fenced code ```` ``` ```` | ✅ | `fenced-code` | lang input + arrow nav |
| indented code (4-space) | 🟡 | (md-it built-in) | md-it produces a `code_block` token (no markup) — same shape as a fenced block with no lang; the existing `code_block` parser handler picks it up. doc-level round-trip stable; **md-text collapses** to fenced form on save. Shape preservation would need a `style: "indent" \| "fenced"` attr (phase 2). |
| thematic break `---` | ✅ | `hr` | |
| HTML block | ⏸️ | — | Deferred. Needs XSS / sanitizer decision (raw render is Typora-style but lets pasted markdown execute scripts). Likely an opt-in plugin. |
| YAML front matter `---\n…\n---` | ✅ | `front-matter` | Custom md-it block rule, only fires at doc start. Stored as a code-block-shaped node (text content, marks: ""). Round-trip preserves body text. Custom `<front-matter>` element to dodge `<pre>` / `<div>` tag collisions. |
| reference link def `[id]: url` | 🟡 | (md-it built-in) | md-it commonmark resolves all 3 forms (`[t][id]` / `[t][]` / `[t]`) to link tokens with resolved href; the `[id]: url` def is consumed silently. doc-level round-trip stable; **md-text collapses** — `[t][id]` + `[id]: url` serializes to `[t](url)` (the def is dropped). Phase-2 work to preserve shape: capture ref defs as nodes and add `refLabel` attr on the link mark. |
| math block `$$…$$` | ⏸️ | — | Deferred. Will be done as an opt-in plugin alongside inline math (KaTeX renderer). |
| table `\| a \| b \|` | 🟡 | `table` | Phase 1: parse / serialize / display + alignment (`:---`, `:---:`, `---:`). Inline marks in cells (em / strong / code / strike / etc.) preserved. Cell content is `inline*` (single line). **Phase 2 pending**: live editor input (`|c1|c2|<Enter>` to start), Tab/Shift-Tab cell nav, row/col add-delete UI. |

## CommonMark — inline

| Syntax | Status | Feature | Notes |
|---|---|---|---|
| em `*x*` / `_x_` | ✅ | `emphasis` | method-B |
| strong `**x**` / `__x__` | ✅ | `emphasis` | method-B |
| nested em+strong `***x***` | 🟡 | `emphasis` | only triggers when both runs ≥3; full rule-of-three not done |
| inline code `` `x` `` | ✅ | `code` | |
| variable-length code fence `` `` ` `` `` | ✅ | `code` | soft-show whitespace inside |
| strike `~~x~~` | ✅ | `strike` | GFM |
| link `[text](url)` | 🟡 | `link` | edge cases: nested `]`, `\]` escape, href with spaces |
| link with title `[t](u "title")` | ✅ | `link` | |
| empty-text link `[](url)` | ✅ | `link` | href rendered as link-styled text |
| image `![alt](src)` | ✅ | `image` | loaded src → `<img>` always rendered as block under source; empty/broken → edit mode with file-input. async load probe; broken icon variant. round-trip stable. |
| autolink `<https://x.com>` | ✅ | `autolink` | method-B; md-it autolink rule disabled (text flows through, scanner derives mark). URL + email; email href gets `mailto:` prefix. `<a>` tag rendering shared with `link` feature, dispatched on `data-autolink`. |
| reference-style link `[t][id]` | 🟡 | (md-it built-in) | See "reference link def" row — same 🟡, same caveat. |
| inline HTML | ⏸️ | — | Deferred (paired with HTML block — same XSS / sanitizer decision). |
| hard break (2-space + `\n`) | ✅ | core | |
| soft break (`\n` in para) | ✅ | core | |
| backslash escape `\*` | 🟡 | core | round-trip covered; no input-time UX |
| inline math `$x$` | ⏸️ | — | Deferred to opt-in KaTeX plugin (same package as math block). |

## Typora extensions

| Syntax | Status | Notes |
|---|---|---|
| highlight `==x==` | ✅ | method-B; same shape as strike (no md-it rule needed — text flows through, normalize derives mark) |
| subscript `~x~` | ✅ | `sub-sup`; method-B. Strike (priority 1, `~~`) consumes first; sub (priority 1.2, `~`) only matches single-tilde pairs. `~~~x~~~` falls through (intentionally). |
| superscript `^x^` | ✅ | `sub-sup`; method-B. `^` doesn't collide with anything else. |
| inline math `$x$` | ⏸️ | (see CommonMark inline row) |
| math block `$$…$$` | ⏸️ | (see CommonMark block row) |
| TOC `[toc]` | ✅ | `toc`; atom block node; NodeView walks doc to render heading tree, refresh plugin re-renders on every transaction. Enter on a paragraph whose text is exactly `[toc]` / `[TOC]` converts. Click on entry → scroll to heading. |
| emoji `:smile:` | ✅ | `emoji`; widget renders glyph, source chars hidden when cursor outside. Autocomplete dropdown opens while typing `:partial`; Tab/Enter commits the first match. Hand-curated subset of names. |
| diagram fences (mermaid, flow, …) | ⏸️ | Deferred. Would extend `fenced-code` via lang routing + opt-in mermaid plugin (heavy renderer; better as a separate package). |
| HTML comment `<!-- -->` | ✅ | `html-comment`; method-B mark wrapping the whole `<!-- ... -->` source. md-it `html: false` already lets it flow through as text. Always visible (gray italic), no cursor-aware show/hide. |

## Editor behaviors (non-syntax)

| Behavior | Status | Notes |
|---|---|---|
| auto-pair `[`/`(` + skip-over `]`/`)` + Backspace clear | ✅ | `auto-pair` |
| cursor-aware syntax hint (gray delim when inside span) | ✅ | `decorations` |
| method-B normalize (text → marks every tx) | ✅ | `normalize` |
| lossless round-trip (parse → serialize → parse) | ✅ | `roundtrip.test` |

## Known limitations carried forward

See `CLAUDE.md` § "Method-B limitations carried forward" for the full list; the headline items are mirrored in the 🟡 rows above.
