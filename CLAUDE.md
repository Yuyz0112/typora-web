# typora-web

A Typora-style WYSIWYG Markdown editor built on ProseMirror.

## State model

```
md text  ───────┐                                          (IO boundary; on-disk format)
               parse / serialize (doc must round-trip losslessly)
PM doc + selection  ───── runtime authority
  │   textblock text keeps source delim chars (`*`, `**`, `` ` ``, `~~`, `[`/`](href)`)
  │   inline marks = derived each transaction by `normalize` (method B)
  ↓
normalize delim ranges  — inline decorations (`syntax-hint` / `syntax-hidden`)
view (DOM, built by PM EditorView)
```

- **Runtime authority** is `EditorState = { doc, selection, storedMarks, plugins }`. Transactions and decoration logic live at the PM doc layer.
- **md is not reactive**: it only appears at load / save / "show source" boundaries.
- **Method B is the only path** for inline features (em / strong / code / strike / link). The textblock's textContent contains the source delim chars verbatim; the corresponding mark is derived in `normalize.ts`'s `appendTransaction` by running `parseInline`. Flip side: those delim chars round-trip through the serializer raw (not `\*` escaped), because they *are* the md source.
- **Lossless round-trip** is an invariant over nodes/marks/attrs only. `selection`, `history`, decorations, IME state are ephemeral.
- See `~/.claude/projects/-Users-yanzhen-fiddle-typora-web/memory/project_state_model.md` for the original rationale.

## File map

### Top-level layout

The repo splits four ways. The dependency rule is one-way: `src/`
never imports from `tests/` / `specs/` / `website/`. That's what
keeps lib mode's bundle free of test fixtures and harness UI.

```
src/         editor lib (lib mode entry: src/lib.ts)
specs/       test/spec data — cases, renderCases, event DSL, pretty
tests/       *.test.ts + runFeatureCases driver
website/     harness UI — main.ts, index.html, style.css
```

`tsconfig.json` includes all four; vite's website build uses
`root: "website"`; lib build is configured via `vite.lib.config.ts`.

### Core (`src/`)

| File | Responsibility |
|---|---|
| `lib.ts` | Public API. Re-exports `defaultPlugins`, `createState`, `schema`, `parse`, `serialize`. Lib bundle's import root — must not transitively reach specs/tests/website. |
| `schema.ts` | PM schema. Merges `coreNodes` (doc/paragraph/text/hard_break/heading/blockquote/code_block/lists) with `collectNodes()` / `collectMarks()` from features. No core marks — every mark belongs to a feature. |
| `parser.ts` | md → PM doc. `ParserState` is exported for features (with `topMark(type)` so close-handlers can read attrs before closing). Core block / text / softbreak / hardbreak tokens handled inline; all other tokens dispatched through `collectParserTokens()`. Registered `mdItPlugins` run on the singleton markdown-it instance. |
| `serializer.ts` | PM doc → md. Mark delimiters come from `collectMarkDelims()`; each inline feature's `extRanges(parent)` marks the chars that must be emitted raw (no backslash escape) so method-B delim chars survive round-trip. |
| `inline-parse.ts` | Method-B inline parser. Utilities: `scanRuns`, `scanFixedDelim`, `markConsumed`, `markExtRanges`. Orchestration: `parseInline(text)` runs every inline feature's `scan` in ascending `priority`, sharing a `consumed` bitmap. `InlineSpan.attrs` lets attr-bearing marks (link's `{href, title}`) flow through normalize. |
| `normalize.ts` | The authoritative "text → marks" step. `appendTransaction` walks every textblock, runs `parseInline`, and syncs em / strong / code / strike / link marks. Plugin state exposes `delim` ranges for decorations. Attr-bearing marks are always re-applied (bitmap diff can't detect href/title changes). |
| `decorations.ts` | `syntaxHintsPlugin` — reads `getDelims(state)` from normalize and wraps each delim range in an inline `Decoration` with class `syntax-hint` (cursor in the surrounding span) or `syntax-hidden` (outside). Single path; the old widget path is gone. |
| `cursor-render.ts` | `cursorRenderPlugin()` — paints the selection as a widget. Empty selection → `<span class="play-caret">`, non-empty → `selection-marker` on both ends. Since gray delims are now inline decorations on real chars, no dynamic `side` juggling. |
| `input-rules.ts` | Thin shell: `inputRules({ rules: collectInputRules(schema) })` + `spaceBreaksStoredMarks`. Under method B, no inline feature registers input rules — normalize handles everything. Input rules remain available for block-shaped syntaxes that aren't delim-pair based. |
| `editor.ts` | `defaultPlugins()`: history / keymap / input-rules / space-breaks / **normalizeInlinePlugin** / syntaxHints / cursorRender / baseKeymap. Same stack in live editor and test pretty. |

### Features (`src/features/`)

| File | Owns |
|---|---|
| `_types.ts` | `FeatureSpec`, `InlineFeatureSpec`, `TokenHandler`. (Test-data types — `Case`, `Checkpoint`, `RenderCase`, `FeatureSpecs` — live in `specs/_types.ts`.) |
| `index.ts` | `ALL_FEATURES` registry plus `collectX()` helpers that core modules read. Adding a feature = one import + one array entry. |
| `emphasis.ts` | em + strong (priority 2). Merged because they share one `*`/`_` runs scanner (strong wins when both ends have ≥ 2 chars). |
| `code.ts` | inline code `` `x` `` (priority 0, wins over emphasis). |
| `strike.ts` | strike `~~x~~` (priority 1). Enables markdown-it's strikethrough rule via `mdItPlugins`. |
| `link.ts` | link `[text](href "title")` (priority 3). Uses a regex scanner (asymmetric close delim carrying `href`/`title` attrs) rather than delim-runs. Parser close-handler reads `href` via `ParserState.topMark` to emit `](url)` as raw text, so the doc's text has the full source. |

### Specs (`specs/`)

| File | Owns |
|---|---|
| `_types.ts` | `Case`, `Checkpoint`, `RenderCase`, `FeatureSpecs`. The dual to `FeatureSpec` for test/spec data. |
| `events.ts` | `feedEvent(view, e)` — translates the event DSL into a transaction. View surface is minimal (`{state, dispatch, endOfTextblock, hasFocus}`). |
| `pretty.ts` | Spins up a real `EditorView` in happy-dom; walks `view.dom` to HTML-ish text. Reads `collectRenderCases()` from `specs/features/index.ts`. Skips `syntax-hidden` spans. |
| `features/<name>.specs.ts` | Per-feature `cases` + `renderCases`. Sibling to `src/features/<name>.ts`. |
| `features/index.ts` | `ALL_SPECS` registry plus `collectCases` / `collectRenderCases`. Imported by tests and website only. |

### Tests (`tests/`)

| File | Owns |
|---|---|
| `utils.ts` | `setup(md)` / `apply(state, events)` / `pretty(state)` + `runFeatureCases(specs)`. The feature test driver. |
| `<*>.test.ts`, `features/<name>.test.ts` | Vitest specs. Each feature test is `runFeatureCases(<name>Specs)`. |

### Website (`website/`)

| File | Owns |
|---|---|
| `main.ts` | Visualisation harness. `SCRIPTS = featureScripts (from collectCases()) + coreScripts (hand-written plain/cursor/history)` — one data source for both assertions and the harness. |
| `index.html` | Vite entry. `root: "website"` in `vite.config.ts`. |
| `style.css` | All editor + harness CSS. (TODO: split editor styles back into a lib-shipped CSS when lib gets a polished CSS story.) |

## Architectural invariants

1. **Schema is the whitelist.** Every doc shape the schema allows must be losslessly serialisable to md. For each syntax the trio must stay in sync:
   - schema node/mark
   - parser token → node/mark mapping
   - serializer delimiters / block handlers

2. **pretty is a projection of the real view DOM.** `test-pretty.ts` runs a real `EditorView` in happy-dom, so cursor position, decoration ordering, mark nesting are all decided by PM.
   - Do not reintroduce a standalone renderer — that path caused snapshot/view drift once already.

3. **One plugin stack.** `defaultPlugins()` is used by both the real view and the test pretty. Cursor, decorations, normalize and input rules all go through it.

4. **Method-B is the only path for inline marks.** Text in the doc is the source (contains delim chars); `normalize.ts` is the single authority that turns text into mark structure. Do NOT manually add/remove inline marks in feature code or other plugins — normalize will overwrite on the next transaction. If a new inline syntax needs different semantics, extend `parseInline` and normalize. Attr-bearing marks (link) carry their attrs through `InlineSpan.attrs`; normalize passes them to `markType.create(attrs)`.

5. **Features are self-contained, but split across `src/` and `specs/`.** Each feature's runtime seams (schema / parser token / serializer delim / input rule / inline scanner / keymap / plugins) live in `src/features/<name>.ts`. Each feature's test/demo data (`cases`, `renderCases`) lives in `specs/features/<name>.specs.ts`. Both are aggregated by their respective `index.ts`. Adding a feature = one entry in each registry. This is what lets multiple agents develop features in parallel with minimal conflict surface AND keeps lib mode free of test fixtures.

## How to add a Markdown syntax

Worked example: an inline-mark feature (the four existing ones emphasis / code / strike / link are the reference templates).

1. **Create `src/features/<name>.ts`** exporting a `FeatureSpec`:
   - `marks` — PM mark spec (parseDOM/toDOM).
   - `parserTokens` — markdown-it token handlers. For method-B marks, open/close handlers emit the delim chars via `state.addText` *and* push/pop the mark:
     ```ts
     em_open:  (s, _, schema) => { s.addText("*"); s.openMark(schema.marks.em.create()); },
     em_close: (s, _, schema) => { s.closeMarkType(schema.marks.em); s.addText("*"); },
     ```
   - `markDelims` — serializer delim table. Method-B marks use `{ open: "", close: "" }` because the delim chars already live in the text.
   - `renderCases` — tag → HTML-ish DSL (e.g. `em: (c) => \`<i>${c}</i>\``).
   - `inline` (for method-B inline marks):
     ```ts
     inline: {
       priority: 2,                                      // code 0, strike 1, emphasis 2
       scan:      (text, consumed) => /* emit InlineSpans */,
       markNames: ["em", "strong"],
       extRanges: (parent) => markExtRanges(parent, "em", 1),
     }
     ```
     `scanFixedDelim` in `inline-parse.ts` covers most fixed-length delim cases.
   - `cases` — one or more `Case = {id, label, seed, events, checkpoints}`. Each `Checkpoint = {at, expect}` is an independent test; `at` is the number of events to feed before asserting. The full `events` stream also becomes a harness preset.
   - `mdItPlugins` — if the syntax isn't in CommonMark (e.g. strikethrough: `[(md) => md.enable("strikethrough")]`).
2. **Create `src/features/<name>.test.ts`**:
   ```ts
   import { runFeatureCases } from "../test-utils.ts";
   import { myFeature } from "./myFeature.ts";
   runFeatureCases(myFeature);
   ```
3. **Register** in `src/features/index.ts`: one `import` + one entry in `ALL_FEATURES`.
4. Run `npx vp test --run` — feature cases + roundtrip + parser tests all need to stay green.

For marks that don't fit the delim-pair shape, see `link.ts` — its `scan` is a regex (close delim carries data), the open/close parser handlers emit full source text (`[` and `](href "title")`) while push/pop the mark, and its `extRanges` reaches past `contentTo` by the dynamic close-delim length. Block-level syntaxes additionally need `nodes` + serializer block handlers; that block-level surface hasn't been exercised yet.

## Test DSL

### pretty output format

| Symbol | Meaning |
|---|---|
| plain chars | verbatim (including method-B delim chars when the cursor is outside the mark's span — they are visually hidden via `.syntax-hidden`, and test-pretty emits nothing for them) |
| `<i>…</i>` | em |
| `<b>…</b>` | strong |
| `<c>…</c>` | inline code |
| `<s>…</s>` | strike |
| `<l:url>…</l>` | link |
| `<g>*</g>`, `<g>**</g>`, `` <g>`</g> ``, `<g>~~</g>`, `<g>[</g>` / `<g>](href)</g>` | gray source delimiter shown when the cursor is inside the mark's surrounding span |
| `|` | empty-selection caret |
| `[…]` | non-empty selection |
| `# `, `- `, `1. `, `> `, ```\`\`\`lang\n…\n\`\`\` ```, `<hr/>`, `<br/>`, `<toc/>`, `<yaml-block content="…" />`, `<comment>…</comment>`, `<a:url>…</a>`, `<mark>…</mark>`, `<sub>…</sub>`, `<sup>…</sup>` | block / inline structure markers |

### Event DSL

- Single-character string — one character (`"a"`, `"*"`, `" "`).
- `<Key>` form for special keys: `<Enter>` `<Backspace>` `<Tab>` `<ArrowLeft>` `<Home>` `<End>` `<Delete>`.
- `<Mod-X>` — cross-platform, mapped to Meta or Ctrl based on `navigator.platform`.
- Multi-character strings are fed character by character (so `"hello"` behaves the same as `"h","e","l","l","o"`).

## TDD rhythm

The canonical loop for a new inline feature:

1. **Write red cases** in `src/features/<name>.ts`. A case = seed + events + checkpoints:
   ```ts
   cases: [
     {
       id: "asterisks",
       label: "italic via single asterisks",
       seed: "",
       events: ["*","1","*"," "],
       checkpoints: [
         { at: 3, expect: "<g>*</g><i>1</i><g>*</g>|" },
         { at: 4, expect: "<i>1</i> |" },
       ],
     },
   ],
   ```
   `runFeatureCases(feature)` expands each checkpoint into an independent `test()` — intermediate invariants stay covered.
2. `npx vp test --run features/<name>` — confirm it's red.
3. Fill in schema / parser / serializer / renderCases / inline scanner / extRanges.
4. Run again; expect green. Same `events` array shows up in the harness as a preset automatically (via `collectCases`) — open `npm run dev` and eyeball step-by-step.

### Guiding principles

- **Assertions describe what the user sees**, not internal state. `pretty` comes from the real view DOM, so the assertion is a visual contract.
- When unsure about expected behaviour, **ask for a manually verified Typora case** and reverse-engineer. Do not guess specs.
- Prefer PM primitives: `defining` / `isolating` / `marks:""` / `inclusive:false` / parseDOM priority. Non-obvious flags should be explained in a comment or pinned with a test.
- Under method B, don't try to "set the right mark at input time" — let normalize do it. Your input-rule/typing logic should only mutate text; mark structure comes from a subsequent `appendTransaction`.

## Visualisation harness (main.ts)

`npm run dev` opens the harness. Select a preset → Reset → Step/Play to watch the editor evolve under a scripted event stream. `pretty()` and `serialize()` panels are rendered alongside so they can be compared with test assertions. `SCRIPTS` is assembled from `collectCases()` (one entry per feature case) plus a small hand-written set of core presets — copying an `events` array across turns one into a visual demo and vice versa without any manual sync.

## Known gotchas

- **`navigator.platform`** — Node 22 ships with a `navigator` global whose platform is `"MacIntel"`, so PM normalises `Mod` to `Meta`. `events.ts` already branches on it.
- **`tr.insertText` and storedMarks fallback** — when `storedMarks` is `null`/`[]`, PM falls back to `$from.marks()`; an inclusive mark will re-attach. To insert text with genuinely no marks, build the text node directly with `schema.text(text)` and use `tr.replaceWith`.
- **Widget ordering** — multiple widgets at the same PM position render in ascending `side`. Under method-B the gray delims are inline decorations on real chars so caret placement no longer fights widget side ordering — if you reintroduce widget delims you'll need to restore the dynamic-side dance in `cursor-render.ts`.
- **PM widget class list** — PM appends `ProseMirror-widget` to every widget element, so test-pretty uses `classList.contains(...)`.
- **Trailing `<br class="ProseMirror-trailingBreak">`** — PM inserts a placeholder into empty textblocks. test-pretty filters it out.
- **Headless env startup** — happy-dom adds ~700ms to cold-start the test environment. Each test itself remains fast.
- **Method B: hidden delims still occupy PM positions.** Arrow keys may briefly land on a `.syntax-hidden` `*` — the delim becomes visible again once the cursor enters the surrounding span. Don't try to "skip" these positions unless you also rewrite cursor-render coordination.
- **Normalize runs every transaction.** Writing your own plugin that mutates inline marks will race with normalize (normalize wins). Change text, not marks.

## Method-B limitations carried forward

- **Nesting**: `parseInline` only recognises the outermost pair — `***both***` ends up as strong(em(…)) in md-it parse but normalize will rebuild it as just strong. Revisit when inline parse grows a nesting pass.
- **Backtick-fence upgrade**: `` `` ` `` `` (double backtick fence with embedded single backtick) isn't recognised — `roundtrip.test` for this case is `.skip`ped. Requires variable-length code fence support in both parser-token emission and `inline-parse` code scanner.
- **Link edge cases**: the link scanner's regex (`/\[([^\]]*?)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)/g`) doesn't handle nested `]`, escaped `\]`, or href with spaces. Enough for the pilot; needs a hand-rolled scanner for full CommonMark coverage.
