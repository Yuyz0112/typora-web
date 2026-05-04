# typora-web

> A Typora-style Markdown editor for the web.

Markdown looks like a finished document while you write it. Italic renders as *italic* the moment you close the asterisks. Headings appear at their final size as soon as you start typing. Source markers like `*` and `#` fade out when the cursor moves away and come back when you click in.

It's also an experiment. Every line of source was written by an AI agent through chat. The human only chats; nothing gets typed directly into source files. To keep the agent productive at this scale, each supported syntax is described as a **spec**: a seed text, an event sequence, and the expected rendered output. Each spec compiles to a test the agent has to make pass. The result is a usable editor and a record of how far agent coding holds up on a serious project.

## Try it

> If you're reading this on GitHub, the live editing effect won't show. Visit the [live demo][demo] for the actual editor.

Inline marks: **bold**, *italic*, `inline code`, ~~strike~~, ==highlight==, sub like H~2~O, sup like E = mc^2^. Bare URLs in angle brackets become autolinks: <https://prosemirror.net>. Regular links work the usual way: [ProseMirror guide][pmguide], [CommonMark spec][cm]. Emoji shortcodes resolve as you type: :books: :tada: :hourglass: :warning:.

Task lists hold their state visually:

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

> Blockquotes render inline marks just like paragraphs do. You can drop ==highlights==, [links](https://typora.io), or `code` into a quote and the source still round-trips byte for byte.
>
> Press Enter on an empty quote line to exit.

Press `⌘/` (or `Ctrl+/`) at any time to toggle between rendered and raw source view.

## Install

```sh
npm install typora-web
```

## Usage

```ts
import { createEditor } from "typora-web";
import "typora-web/widgets.css";
import "typora-web/theme-typora.css";

const editor = createEditor(document.querySelector("#app")!, {
  initialContent: "# hello",
  onChange: (md) => console.log(md),
});
```

Controller methods:

| Method / field | Description |
|---|---|
| `editor.getMarkdown()` | current markdown |
| `editor.setMarkdown(md)` | replace contents |
| `editor.toggleSource()` | flip rendered ↔ raw view (also bound to `⌘/` / `Ctrl+/`) |
| `editor.isSourceMode()` | boolean |
| `editor.focus()` | focus the active surface |
| `editor.destroy()` | tear down |
| `editor.view` | underlying ProseMirror EditorView. No stability guarantee on this access. |

Options: `initialContent`, `onChange(md)`, `onFocus()`, `onBlur()`.

Two themes ship: `typora-web/theme-typora.css` (default look on the live demo) and `typora-web/theme-github.css`. Import one. To roll your own, write a stylesheet that targets `.ProseMirror` descendants.

## Coverage

Legend: :white_check_mark: stable · :yellow_circle: partial (note explains what's missing) · :pause_button: todo.

### Block syntax

| Syntax | Status | Notes |
|---|:---:|---|
| paragraph | :white_check_mark: | |
| ATX heading `#`..`######` | :white_check_mark: | |
| setext heading (`===` / `---` underline) | :white_check_mark: | |
| blockquote `>` | :white_check_mark: | |
| bullet list `-` `*` `+` | :white_check_mark: | |
| ordered list `1.` | :white_check_mark: | |
| nested list | :white_check_mark: | |
| task list `- [ ]` / `- [x]` | :white_check_mark: | |
| fenced code ```` ``` ```` | :white_check_mark: | |
| indented code (4-space) | :yellow_circle: | parses fine; saves as fenced (shape attr not yet preserved) |
| thematic break `---` | :white_check_mark: | |
| table `\| a \| b \|` | :white_check_mark: | |
| YAML front matter | :white_check_mark: | |
| reference link def `[id]: url` | :yellow_circle: | live entry committed as block; reload drops the def node (markdown-it consumes it on parse) |
| HTML block | :pause_button: | needs sanitizer policy; planned as opt-in plugin |
| math block `$$…$$` | :pause_button: | planned as opt-in KaTeX plugin |

### Inline syntax

| Syntax | Status | Notes |
|---|:---:|---|
| em `*x*` / `_x_` | :white_check_mark: | |
| strong `**x**` / `__x__` | :white_check_mark: | |
| nested `***em+strong***` | :yellow_circle: | works only when both runs ≥ 3 chars; full rule-of-three pending |
| inline code `` `x` `` | :white_check_mark: | |
| strike `~~x~~` | :white_check_mark: | |
| link `[text](url)` | :yellow_circle: | edge cases: nested `]`, `\]` escape, hrefs with spaces |
| link with title `[t](u "title")` | :white_check_mark: | |
| empty-text link `[](url)` | :white_check_mark: | |
| image `![alt](src)` | :white_check_mark: | |
| autolink `<https://x.com>` | :white_check_mark: | |
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
| subscript `~x~` | :white_check_mark: | |
| superscript `^x^` | :white_check_mark: | |
| `[toc]` block | :white_check_mark: | |
| emoji `:smile:` | :white_check_mark: | |
| HTML comment `<!-- -->` | :white_check_mark: | |
| diagram fences (mermaid, flow, …) | :pause_button: | planned as opt-in plugin (heavy renderer) |

### Editor behaviors

| Behavior | Status | Notes |
|---|:---:|---|
| cursor-aware delimiter hinting | :white_check_mark: | |
| auto-pair brackets | :white_check_mark: | |
| lossless `parse → serialize → parse` | :white_check_mark: | |

## Spec

Specs are the project's core design choice and the harness the agent works in. Each Typora behavior is captured as a **spec**: a seed text, a sequence of input events, and the rendered output expected at each checkpoint. Every spec runs directly as a test case; the agent ships a behavior by making the test pass. Describing behaviors this way is what makes a project this size tractable for an agent to build.

The catalog lives at the [`/specs`][demo-specs] page in the live demo, where each card is a spec you can step through.

## Contributing

Bug reports and feature requests are accepted as specs. If a Typora behavior isn't matched, file an issue with:

- a **seed** (the markdown the editor starts from; can be empty)
- an **event sequence** (the keys you press; the same DSL existing specs use)
- the **rendered output** Typora produces

The "report" link on every card in the [live demo's catalog][demo-specs] prefills an issue with seed, events, and observed output ready for you to fill in.

[demo]: https://yuyz0112.github.io/typora-web/ "live demo"
[demo-specs]: https://yuyz0112.github.io/typora-web/#/specs "spec catalog"
[cm]: https://spec.commonmark.org/ "CommonMark"
[pmguide]: https://prosemirror.net/docs/guide/ "ProseMirror Guide"
