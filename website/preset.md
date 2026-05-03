# typora-web

[toc]

**typora-web** is a faithful port of [Typora][typora]'s WYSIWYG markdown editing into the browser, built on **ProseMirror**. What you're reading now *is* the editor — click anywhere and start typing. Press `⌘/` (or `Ctrl+/`) at any time to flip between rendered and source view.

<!-- this whole page is the live demo; edit freely, the source round-trips -->

## Why another editor?

Typora set the bar for **inline-rendered** markdown: you see ==highlighted== prose, ~~struck-through~~ drafts, and `inline code` exactly where you wrote them, with raw `*` and `_` only peeking out when the cursor is nearby. Porting that feel to the web — losslessly, on a real structured document model — turns out to be a deep problem. We're working through it one behavior at a time.

The pitch in one line: **every supported syntax is a spec, and every spec is a scripted scenario ported from observed Typora behavior**.

## How we work

We do **spec-TDD**. A spec is a seed string + an event sequence + checkpoints describing what the rendered DOM should look like at each step. The editor has to make that scenario pass before we call the syntax done. To browse the catalog of what's covered, [browse the catalog](#/specs).

Found a Typora behavior we *don't* match? File it as a new spec — same shape — and we'll work it red→green. Bug reports, feature requests, and "Typora does X but you do Y" reports all flow through the same channel. :bug:

## What you can try right now

- [x] type `**bold**`, `*italic*`, `~~strike~~`, `==highlight==`, `` `code` ``
- [x] superscript like E = mc^2^ and subscripts like H~2~O
- [x] paste a URL inside angle brackets: <https://prosemirror.net>
- [x] regular links like the [ProseMirror guide](https://prosemirror.net/docs/guide/ "PM docs")
- [x] emoji shortcodes — :tada: :books: :hourglass: :warning: :white_check_mark:
- [ ] inline math `$x^2$` (deferred; KaTeX plugin planned)
- [ ] diagram fences (mermaid/flow; deferred to opt-in plugin)

### Nested lists & blockquotes work too

1. Top-level ordered item
   - nested bullet, with a `code span` inside
   - another nested bullet, **bold** here
     1. and a third level
2. Back to the outer list

> Typora's blockquote feel — gray rule on the left, inline marks rendered in place. Quotes nest, and you can drop ==highlights== or [links](https://typora.io) inside without breaking the source.
>
> Press Enter twice to exit, just like in Typora. Round-trip is a hard invariant: `parse → serialize → parse` must produce an identical PM doc, tested on every commit.

---

## Compatibility snapshot

A representative slice of [`SYNTAX.md`](https://github.com/) — see the repo for the full matrix.

| Family            | Example                  | Status |
| ----------------- | ------------------------ | :----: |
| inline marks      | `*em*`, `**strong**`     |  :white_check_mark:   |
| inline code       | `` `x` ``                |  :white_check_mark:   |
| Typora highlight  | `==x==`                  |  :white_check_mark:   |
| sub / sup         | `H~2~O`, `x^2^`          |  :white_check_mark:   |
| autolink          | `<https://…>`            |  :white_check_mark:   |
| task list         | `- [ ]` / `- [x]`        |  :white_check_mark:   |
| nested list exit  | 3-step staircase         |  :white_check_mark:   |
| fenced code + lang| ```` ```ts ````          |  :white_check_mark:   |
| table + alignment | this table               |  :white_check_mark:   |
| TOC               | `[toc]`                  |  :white_check_mark:   |
| inline / block math | `$x$`, `$$…$$`         |   :hourglass:    |
| HTML block        | raw `<div>`              |   :hourglass:    |

## A taste of fenced code

Lang is editable; arrow keys cross the fence boundary like in Typora.

```ts
import { EditorState } from "prosemirror-state";
import { defaultPlugins } from "./editor";

// every transaction runs `normalize`, which derives marks from text.
const state = EditorState.create({ schema, plugins: defaultPlugins() });
```

## Reading list

Markdown is a deceptively deep target — these helped shape our model:

- the [CommonMark spec][cm] for the parts everyone agrees on
- Typora's own help docs for the parts only Typora does
- ProseMirror's [guide][pmguide] for the doc/transaction discipline that makes round-trip possible :books:

[typora]: https://typora.io
[cm]: https://spec.commonmark.org/
[pmguide]: https://prosemirror.net/docs/guide/
