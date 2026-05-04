# typora-web

> A Typora-style Markdown editor for the web.

A structured editor where source and rendered view are the same view: `*em*` shows as *em* in place, the `*` chars stay in the document, and fade in only when the cursor is near them. Under the hood it's a [ProseMirror][pmguide] document with a Markdown parser/serializer pinned together so `parse → serialize → parse` produces an identical doc — visual editing without losing the original source shape.

What you're reading right now is the editor itself. Click anywhere and start typing.

## Try it

Inline marks render where you typed them: **bold**, *italic*, `inline code`, ~~strike~~, ==highlight==, sub like H~2~O and sup like E = mc^2^. Paste a bare URL in angle brackets and it lights up: <https://prosemirror.net>. Regular links work too — see the [ProseMirror guide][pmguide] or the [CommonMark spec][cm]. Emoji shortcodes resolve as you type: :books: :tada: :hourglass: :warning:.

Task lists hold state visually:

- [x] inline marks (em, strong, code, strike, highlight, sub/sup)
- [x] autolinks and reference-style links
- [x] tables with per-column alignment
- [ ] inline and block math (planned, KaTeX-based)
- [ ] diagram fences like mermaid (planned, opt-in)

Lists nest, and exit on a triple-Enter staircase the way Typora does:

1. outer ordered item
   - nested bullet with a `code span`
   - another, with **bold** in it
     1. third level
2. back to the outer list

> Blockquotes render inline marks in place, just like paragraphs. You can drop ==highlights==, [links](https://typora.io), or `code` into a quote and the source still round-trips byte-for-byte.
>
> Press Enter on an empty quote line to exit.

---

## Editor behaviors

A few interactions worth knowing:

- **`⌘/`** (or `Ctrl+/`) toggles between rendered and raw source view.
- **`⌘`-click** a link to open it; plain click places the cursor inside, where the URL becomes editable.
- **Click a task checkbox** to toggle done/undone — no need to edit the `[ ]`.
- **Inside a table**: `Tab` / `Shift+Tab` moves between cells; the floating toolbar on focus has a hover-grid resizer, per-column alignment, and delete. Boundary cells consume `Tab` without escaping the table.
- **Inside a fenced code block**: the language tag is an editable input; `↑` / `↓` at the first/last line crosses the fence into surrounding paragraphs.
- **Auto-pairing** for `[` and `(` — type the opener, get the closer; type the closer over an existing one to skip; `Backspace` removes both.
- **`[toc]`** on its own line becomes a live table of contents; click an entry to jump.

For a behavior catalog browsable in-app, open [`#/specs`](#/specs).

## Coverage

Legend: :white_check_mark: stable · :yellow_circle: partial (note explains what's missing) · :pause_button: deferred by design.

### Block syntax

| Syntax | Status | Notes |
|---|:---:|---|
| paragraph | :white_check_mark: | trailing-space preserved |
| ATX heading `#`..`######` | :white_check_mark: | |
| setext heading (`===` / `---` underline) | :white_check_mark: | parser-only; underline shape preserved on save |
| blockquote `>` | :white_check_mark: | nests, inline marks render inside |
| bullet list `-` `*` `+` | :white_check_mark: | tight/loose distinction not asserted |
| ordered list `1.` | :white_check_mark: | |
| nested list | :white_check_mark: | Typora-style 3-step staircase exit |
| task list `- [ ]` / `- [x]` | :white_check_mark: | click checkbox to toggle |
| fenced code ```` ``` ```` | :white_check_mark: | editable lang tag, arrow-key crossing |
| indented code (4-space) | :yellow_circle: | parses fine; saves as fenced (shape attr not yet preserved) |
| thematic break `---` | :white_check_mark: | |
| table `\| a \| b \|` | :white_check_mark: | alignment, inline marks in cells, floating toolbar |
| YAML front matter | :white_check_mark: | only at doc start, body text preserved |
| reference link def `[id]: url` | :yellow_circle: | live entry committed as block; reload drops the def node (markdown-it consumes it on parse) |
| HTML block | :pause_button: | needs sanitizer policy; planned as opt-in plugin |
| math block `$$…$$` | :pause_button: | planned as opt-in KaTeX plugin |

### Inline syntax

| Syntax | Status | Notes |
|---|:---:|---|
| em `*x*` / `_x_` | :white_check_mark: | |
| strong `**x**` / `__x__` | :white_check_mark: | |
| nested `***em+strong***` | :yellow_circle: | works only when both runs ≥ 3 chars; full rule-of-three pending |
| inline code `` `x` `` | :white_check_mark: | variable-length fence supported |
| strike `~~x~~` | :white_check_mark: | |
| link `[text](url)` | :yellow_circle: | edge cases: nested `]`, `\]` escape, hrefs with spaces |
| link with title `[t](u "title")` | :white_check_mark: | |
| empty-text link `[](url)` | :white_check_mark: | href becomes the visible link text |
| image `![alt](src)` | :white_check_mark: | async load probe, broken-icon fallback, file-input edit mode |
| autolink `<https://x.com>` | :white_check_mark: | URL and email; email gets `mailto:` prefix |
| reference-style link `[t][id]` | :yellow_circle: | resolves to inline link on parse; def block is the :yellow_circle: piece |
| hard break (2-space + `\n`) | :white_check_mark: | |
| soft break (`\n` in para) | :white_check_mark: | |
| backslash escape `\*` | :yellow_circle: | round-trip works; no input-time UX |
| inline HTML | :pause_button: | paired with HTML block decision |
| inline math `$x$` | :pause_button: | planned with math block |

### Typora extensions

| Syntax | Status | Notes |
|---|:---:|---|
| highlight `==x==` | :white_check_mark: | |
| subscript `~x~` | :white_check_mark: | single-tilde only; `~~~x~~~` falls through |
| superscript `^x^` | :white_check_mark: | |
| `[toc]` block | :white_check_mark: | live, click entries to scroll |
| emoji `:smile:` | :white_check_mark: | autocomplete dropdown while typing `:partial`; Tab/Enter commits |
| HTML comment `<!-- -->` | :white_check_mark: | rendered as gray italic, always visible |
| diagram fences (mermaid, flow, …) | :pause_button: | planned as opt-in plugin (heavy renderer) |

### Editor behaviors

| Behavior | Status | Notes |
|---|:---:|---|
| cursor-aware delimiter hinting | :white_check_mark: | gray `*` / `==` / `` ` `` etc. when cursor is inside the span |
| auto-pair brackets | :white_check_mark: | `[`/`(` open, skip-over close, Backspace clears both |
| lossless `parse → serialize → parse` | :white_check_mark: | enforced by test suite on every commit |

## Reading

Markdown looks small and turns out to be deep. These were useful while building this:

- the [CommonMark spec][cm] for the parts everyone agrees on
- [Typora][typora]'s help docs for the parts only Typora does
- ProseMirror's [guide][pmguide] for the document and transaction model that makes lossless editing tractable :books:

[typora]: https://typora.io "Typora"
[cm]: https://spec.commonmark.org/ "CommonMark"
[pmguide]: https://prosemirror.net/docs/guide/ "ProseMirror Guide"
