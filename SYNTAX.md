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
| indented code (4-space) | ❌ | — | |
| thematic break `---` | ✅ | `hr` | |
| HTML block | ❌ | — | decision pending: raw vs escape |
| YAML front matter `---\n…\n---` | ❌ | — | Typora extension |
| reference link def `[id]: url` | ❌ | — | |
| math block `$$…$$` | ❌ | — | Typora extension |
| table `\| a \| b \|` | ❌ | — | GFM; biggest single block-level item |

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
| autolink `<https://x.com>` | ⏸️ | — | deferred per pilot scope |
| reference-style link `[t][id]` | ❌ | — | |
| inline HTML | ❌ | — | |
| hard break (2-space + `\n`) | ✅ | core | |
| soft break (`\n` in para) | ✅ | core | |
| backslash escape `\*` | 🟡 | core | round-trip covered; no input-time UX |
| inline math `$x$` | ❌ | — | Typora extension |

## Typora extensions

| Syntax | Status | Notes |
|---|---|---|
| highlight `==x==` | ✅ | method-B; same shape as strike (no md-it rule needed — text flows through, normalize derives mark) |
| subscript `~x~` | ❌ | conflicts with strike `~~` — needs disambiguation |
| superscript `^x^` | ❌ | |
| inline math `$x$` | ❌ | |
| math block `$$…$$` | ❌ | |
| TOC `[toc]` | ❌ | |
| emoji `:smile:` | ❌ | |
| diagram fences (mermaid, flow, …) | ❌ | extends `fenced-code` via lang routing |
| HTML comment `<!-- -->` | ❌ | |

## Editor behaviors (non-syntax)

| Behavior | Status | Notes |
|---|---|---|
| auto-pair `[`/`(` + skip-over `]`/`)` + Backspace clear | ✅ | `auto-pair` |
| cursor-aware syntax hint (gray delim when inside span) | ✅ | `decorations` |
| method-B normalize (text → marks every tx) | ✅ | `normalize` |
| lossless round-trip (parse → serialize → parse) | ✅ | `roundtrip.test` |

## Known limitations carried forward

See `CLAUDE.md` § "Method-B limitations carried forward" for the full list; the headline items are mirrored in the 🟡 rows above.
