# typora-web

A Typora-style WYSIWYG Markdown editor built on ProseMirror.

## State model

```
md text  ───────┐                                          (IO boundary; on-disk format)
               parse / serialize (doc must round-trip losslessly)
PM doc + selection  ───── single source of truth          (runtime authority)
  ↕ deriveDecorations(state)  — derived, never stored
view (DOM, built by PM EditorView)
```

- **Runtime authority** is `EditorState = { doc, selection, storedMarks, plugins }`. All transactions, input rules and decoration logic live at the PM doc layer.
- **md is not reactive**: it only appears at load / save / "show source" boundaries.
- **Lossless round-trip** is an invariant over nodes/marks/attrs only. `selection`, `history`, decorations, IME state are ephemeral.
- See `~/.claude/projects/-Users-yanzhen-fiddle-typora-web/memory/project_state_model.md` for the original rationale.

## File map

| File | Responsibility |
|---|---|
| `schema.ts` | PM schema (nodes + marks + attrs). **Every allowed document shape is defined here** — this is the executor of the "schema is the whitelist" rule. |
| `parser.ts` | md → PM doc. Built on markdown-it. Stack-based `ParserState`; each token is mapped to a schema node/mark. |
| `serializer.ts` | PM doc → any string format. `SerializerState` handles block prefixes, the delim stack, pmPos tracking and `PosMarker` injection. Mark delimiters and character escaping are pluggable (`SerializerConfig`); md uses `mdConfig`, other consumers pass their own. |
| `decorations.ts` | `deriveDecorations(state)` — pure function that expands active marks around the cursor into `DecoSpan`s. `syntaxHintsPlugin()` turns those spans into widget decorations that render the gray source delimiters. |
| `cursor-render.ts` | `cursorRenderPlugin()` — paints the selection as a widget. Empty selection uses `<span class="play-caret">`, non-empty uses `selection-marker` on both ends. Dynamic `side`: if the caret lands on a gray boundary it uses ±2 to stay on the visual outside. |
| `input-rules.ts` | Markdown trigger rules (e.g. `*x*` → em) plus `spaceBreaksStoredMarks` (a space exits the freshly created mark). |
| `editor.ts` | `defaultPlugins()` — the plugin stack shared by the live editor and the headless pretty printer. |
| `events.ts` | `feedEvent(view, e)` — translates the event DSL into a transaction. The view parameter only needs `{state, dispatch, endOfTextblock, hasFocus}`; both a real EditorView and the test fakeView satisfy it. |
| `test-utils.ts` | `setup(md)` / `apply(state, events)` / `pretty(state)` — the three-piece test surface. `pretty` is re-exported from test-pretty. |
| `test-pretty.ts` | Spins up a real `EditorView` in happy-dom, converts `view.dom` to HTML-ish text. **No custom renderer** — pure projection. |
| `main.ts` | Visualisation harness (preset / step / play / speed). Uses the same `defaultPlugins()` as tests. |

## Architectural invariants

1. **Schema is the whitelist.** Every doc shape the schema allows must be losslessly serialisable to md. The three pieces live or die together:
   - schema node/mark
   - parser token → node/mark mapping
   - serializer mark delimiters / block handlers

2. **pretty is a projection of the real view DOM.** `test-pretty.ts` runs a real `EditorView` in happy-dom, so cursor position, decoration ordering and mark nesting are all decided by PM.
   - Do not reintroduce a standalone renderer inside test-pretty — that path caused snapshot/view drift once already.

3. **One plugin stack.** `defaultPlugins()` is used by both the real view and the test pretty. Cursor rendering, decorations and input rules all go through it, so test and production behaviour stay aligned.

## How to add a Markdown syntax

Worked example: strikethrough `~~x~~` → an `<s>` mark.

1. **schema.ts** — declare the mark spec:
   ```ts
   strike: { parseDOM: [{ tag: "s" }, { tag: "del" }], toDOM: () => ["s", 0] }
   ```
2. **parser.ts** — add the token handlers:
   ```ts
   case "s_open": state.openMark(marks.strike.create()); return;
   case "s_close": state.closeMarkType(marks.strike); return;
   ```
   (Also enable the markdown-it strikethrough plugin — CommonMark does not include it.)
3. **serializer.ts** — extend `mdConfig.marks`:
   ```ts
   strike: { open: "~~", close: "~~" }
   ```
4. **decorations.ts** — extend the `DELIM` table:
   ```ts
   strike: { open: "~~", close: "~~" }
   ```
5. **test-pretty.ts** — add the tag case to `renderNode`:
   ```ts
   case "s": case "del": return `<s>${children}</s>`;
   ```
6. **Round-trip test** — add `roundTripStable("~~x~~")` to `roundtrip.test.ts`.
7. **Behaviour test** — add the TDD case to `typora.test.ts`.

Block-level nodes (e.g. task lists) take two extra steps: add a block handler in serializer's `blockHandlers`, and add the tag case to `renderNode`.

## How to add an input rule (Typora trigger behaviour)

Worked example: `**x**` → strong.

1. **input-rules.ts**:
   ```ts
   const STRONG_PATTERN = /(?<!\*)\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/;
   const strongRule = new InputRule(STRONG_PATTERN, (state, match, start, end) => {
     const captured = match[1]!;
     const m = schema.marks.strong.create();
     return state.tr
       .delete(start, end)
       .insert(start, schema.text(captured, [m]))
       .setStoredMarks([m]); // keeps the cursor "inside the mark" visually
   });
   ```
   Add it to the `rules` array inside `markdownInputRules()`.
2. The em and strong regexes must lookbehind past each other (`(?<!\*)`), otherwise em would chew off half of a strong trigger.
3. `spaceBreaksStoredMarks` already handles "space exits after creation" — no extra work.

## Test DSL

### pretty output format (what assertions compare against)

| Symbol | Meaning |
|---|---|
| plain chars | verbatim |
| `<i>…</i>` | em (italic) |
| `<b>…</b>` | strong |
| `<c>…</c>` | inline code |
| `<l:url>…</l>` | link |
| `<g>*</g>`, `<g>**</g>`, … | gray source delimiter shown when the cursor is inside the mark |
| `|` | empty-selection caret |
| `[…]` | non-empty selection |
| `# `, `- `, `1. `, `> `, ```\`\`\`lang\n…\n\`\`\` ```, `---`, `<br/>` | block and inline md-ish structure |

### Event DSL

- Single-character string — one character (`"a"`, `"*"`, `" "`).
- `<Key>` form for special keys: `<Enter>` `<Backspace>` `<Tab>` `<ArrowLeft>` `<Home>` `<End>` `<Delete>`.
- `<Mod-X>` — cross-platform, the runner maps to Meta or Ctrl based on `navigator.platform`.
- Multi-character strings are fed character by character (so `"hello"` behaves the same as `"h","e","l","l","o"`).

## TDD rhythm

When adding a new behaviour (example: `**x**` → strong):

1. **Write the red test first** in `typora.test.ts`:
   ```ts
   test("**1** — bold input rule", () => {
     expect(pretty(apply(setup(""), ["*","*","1","*","*"]))).toBe(
       "<g>**</g><b>1</b><g>**</g>|"
     );
   });
   ```
2. `npx vp test --run typora` — confirm it is red.
3. Implement the input rule plus whatever schema/parser/serializer/decoration changes are needed.
4. Run again; expect green.
5. Add the same events to `SCRIPTS` in `main.ts`, open the dev server and eyeball it (the view and the snapshot must agree because they share a renderer).

### Guiding principles
- **Assertions describe what the user sees**, not internal state shapes. `pretty` comes from the real view DOM, so the assertion is a visual contract.
- When unsure about the expected behaviour, **ask for a manually verified case** and reverse-engineer the implementation. Do not guess specs.
- Prefer PM primitives. `defining` / `isolating` / `marks:""` / `inclusive:false` / parseDOM priority often cover what would otherwise be reinvented. Non-obvious flags should be explained in a comment or pinned with a test.

## Visualisation harness (main.ts)

`npm run dev` opens the harness. Select a preset → Reset → Step/Play to watch the editor evolve under a scripted event stream. The bottom panels show `pretty()` and `serialize()` in real time so they can be compared with test assertions.

`SCRIPTS` in main.ts mirrors the cases in `typora.test.ts` — copying an `events` array across turns one into a visual demo and vice versa.

## Known gotchas

- **`navigator.platform`** — Node 22 ships with a `navigator` global whose platform is `"MacIntel"`, so PM normalises `Mod` to `Meta`. `events.ts` already branches on it; do not assume `Mod === Ctrl`.
- **`tr.insertText` and storedMarks fallback** — when `storedMarks` is `null` or `[]`, PM falls back to `$from.marks()`, and an inclusive mark will re-attach. To insert text with genuinely no marks, build the text node directly with `schema.text(text)` and use `tr.replaceWith`.
- **Widget ordering** — multiple widgets at the same PM position render in ascending `side`. To keep the caret on the outside of a mark boundary, its widget uses a dynamic `side` (see `cursor-render.ts`).
- **PM widget class list** — PM appends `ProseMirror-widget` to every widget element, so test-pretty uses `classList.contains("play-caret")` rather than a string equality check.
- **Trailing `<br class="ProseMirror-trailingBreak">`** — PM inserts a placeholder into empty textblocks. test-pretty filters it out.
- **Headless env startup** — happy-dom adds ~700ms to cold-start the test environment. Each test itself remains fast.
