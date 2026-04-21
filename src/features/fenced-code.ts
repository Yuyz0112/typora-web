import type { FeatureSpec } from "./_types.ts";

// Fenced code block feature — STUB / test cases only.
//
// Shape sketch (to be implemented in a separate turn):
//   - draft pattern  ^```(\w*)$  via `leaveLineDraft` helper
//       prefixLen = 3 (only the three backticks are gray; any trailing
//       word-chars are the lang being typed, shown in regular color)
//   - leave-line commit (arrow up/down / click elsewhere):
//       paragraph → code_block(lang=<captured>), cursor lands in the
//       ADJACENT line (outside the new code_block)
//   - Enter override (feature-local keymap, runs before baseKeymap):
//       paragraph → code_block(lang=<captured>), cursor lands INSIDE
//       the new code_block's empty content (distinct from arrow-leave)
//   - inside-block: Enter inserts a newline in the code_block text
//     (standard baseKeymap behaviour for code_block)
//   - NodeView on code_block renders a lang-input overlay (autocomplete)
//     — for main.ts harness; not reflected in test-pretty
//   - imperative commit API: `handle.commit(view)` — used by the lang
//     autocomplete dropdown click handler to flip the paragraph into a
//     code_block without requiring a leave-line event
//   - Backspace at empty block: one press clears main (noop if already
//     empty), second press collapses the whole code_block → paragraph
//
// ────────────────────────────────────────────────────────────────────
// OPEN QUESTIONS / FLAGS (for the implementer)
// ────────────────────────────────────────────────────────────────────
//
//  Q1. Enter-commit vs baseKeymap Enter.
//      In draft paragraph `\`\`\`ts`, Enter should COMMIT (become a
//      code_block with lang=ts, cursor inside). Outside draft, Enter
//      should split the paragraph as usual. feature keymap["Enter"]
//      returns false when not in a draft paragraph so baseKeymap wins.
//      collectKeymaps already runs before baseKeymap — verify on impl.
//
//  Q2. How does pretty express "cursor inside vs outside the block"?
//      test-pretty currently renders <pre> as
//          `\`\`\`${lang}\n${text}\n\`\`\``
//      The caret widget is a <span class="play-caret"> inside the DOM
//      tree, so if cursor is inside the <code>, it should materialise
//      as `|` in the middle of the code fence:
//          `\`\`\`ts\n|\n\`\`\``
//      If cursor is in an adjacent paragraph, it shows up in THAT
//      paragraph, rendering as a separate block after the fence:
//          `\`\`\`ts\n\n\`\`\`\n|`
//      These two pretty strings DO differ — so the test DSL can in
//      principle discriminate "Enter commit (inside)" from the
//      hypothetical "arrow commit (outside)". Cases 3 and 5 below
//      encode the Enter-inside shape; whether pretty really emits that
//      exact string is the first thing to confirm on implementation.
//
//  Q3. Empty-content code_block DOM shape.
//      PM may emit `<pre data-lang="ts"><code><br class="ProseMirror-
//      trailingBreak"/></code></pre>`. test-pretty reads `codeEl.
//      textContent` which is "" in that case → the pretty fence body
//      is "" and the renderer emits `\`\`\`ts\n\n\`\`\``. The caret
//      widget lives as a sibling of the <br>, but .textContent skips
//      element nodes' non-text descendants anyway — so the `|` may
//      NOT show up in the "\n...\n" slot and instead just disappear.
//      If that is what happens, the test-pretty <pre> branch needs a
//      small rework to walk children recursively (similar to blockquote)
//      to surface the cursor. FLAG: if case 3/5 can't express the
//      caret visibly, either fix test-pretty's <pre> case, or relax
//      the checkpoint to omit the cursor (still asserts lang/content
//      correctness, which is the essential signal).
//
//  Q4. Arrow-leave cases are NOT covered this round.
//      ArrowUp / ArrowDown aren't implemented in events.ts, and the
//      leave-line commit path depends on a vertical motion. Covering
//      arrow-leave would require adding those events first.
//
//  Q5. Autocomplete dropdown click commit.
//      This is an imperative `handle.commit(view)` call. It's outside
//      the FeatureSpec.cases surface (no keyboard/text event fires
//      it). Cover in a separate plain `.test.ts` that instantiates a
//      view directly and invokes the handle.
//
//  Q6. NodeView overlay visibility.
//      The lang-input overlay shows/hides based on selection being
//      inside the code_block. test-pretty has no hook for this yet;
//      flagged as out-of-scope.
//
//  Q7. Round-trip: a code_block whose lang is empty serialises as
//      ``` (three backticks then newline). Already handled by core
//      serializer; no feature-level delim work needed here.
//
// ────────────────────────────────────────────────────────────────────

export const fencedCode: FeatureSpec = {
  name: "code_block",

  // No schema / parser / serializer contributions — core already owns
  // code_block. This feature is purely interactive (draft, keymap,
  // NodeView, autocomplete).
  //
  // Implementation will go here:
  //   plugins: (schema) => [leaveLineDraft({...}).plugin, nodeViewPlugin],
  //   keymap:  (schema) => ({ "Enter": commitIfDraft, "Backspace": ... }),

  cases: [
    // ──────────────────────────────────────────────────────────────
    // 1. draft decoration appears once three backticks are on the line
    // ──────────────────────────────────────────────────────────────
    {
      id: "draft-trigger",
      label: "``` enters draft; all three chars show gray",
      seed: "",
      events: ["`", "`", "`"],
      checkpoints: [
        { at: 1, expect: "`|" },
        { at: 2, expect: "``|" },
        // CONFIDENT: leaveLineDraft paints syntax-hint on prefixLen=3.
        { at: 3, expect: "<g>```</g>|" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 2. draft + lang pre-fill: lang chars are NOT gray
    //    pattern ^```(\w*)$, prefixLen = 3 → only backticks turn gray.
    // ──────────────────────────────────────────────────────────────
    {
      id: "draft-with-lang",
      label: "```ts — lang characters are plain (not gray)",
      seed: "",
      events: ["`", "`", "`", "t", "s"],
      checkpoints: [
        { at: 3, expect: "<g>```</g>|" },
        { at: 4, expect: "<g>```</g>t|" },
        // CONFIDENT: prefixLen stays 3 regardless of trailing \w*.
        { at: 5, expect: "<g>```</g>ts|" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 3. Enter commits; cursor lands INSIDE the new code_block.
    //    UNCERTAIN: exact pretty shape of "empty code_block with caret
    //    at row 0 inside". See Q2/Q3. Best guess below — cursor
    //    appears between the two newlines of the fence body.
    // ──────────────────────────────────────────────────────────────
    {
      id: "enter-commit-inside",
      label: "```ts + Enter → code_block(lang=ts), cursor inside",
      seed: "",
      events: ["`", "`", "`", "t", "s", "<Enter>"],
      checkpoints: [
        { at: 5, expect: "<g>```</g>ts|" },
        // UNCERTAIN: pretty may drop `|` if test-pretty's <pre> case
        // stringifies via `codeEl.textContent` (doesn't see widgets).
        // If so, relax to: "```ts\n\n```" (no caret rendered).
        { at: 6, expect: "```ts\n|\n```" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 4. After Enter-commit, typing inserts into the code_block, and
    //    Enter inside produces a newline (baseKeymap for code_block).
    //    UNCERTAIN: same caret-inside-<pre> issue as case 3.
    // ──────────────────────────────────────────────────────────────
    {
      id: "enter-commit-then-type",
      label: "after commit, x<Enter>y types inside the code_block",
      seed: "",
      events: ["`", "`", "`", "t", "s", "<Enter>", "x", "<Enter>", "y"],
      checkpoints: [
        // Expectation hinges on Q3 resolution; relax caret if needed.
        { at: 7, expect: "```ts\nx|\n```" },
        { at: 9, expect: "```ts\nx\ny|\n```" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 5. Enter-commit with empty lang.
    // ──────────────────────────────────────────────────────────────
    {
      id: "enter-commit-no-lang",
      label: "``` + Enter → code_block(lang=''), cursor inside",
      seed: "",
      events: ["`", "`", "`", "<Enter>"],
      checkpoints: [
        { at: 3, expect: "<g>```</g>|" },
        // UNCERTAIN: same caret-placement caveat. lang="" renders as
        // ``` (no language tag) per test-pretty's <pre> branch.
        { at: 4, expect: "```\n|\n```" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 6. Typing a space breaks the pattern ^```(\w*)$ → exit draft.
    //    After space, no decoration; chars render verbatim.
    // ──────────────────────────────────────────────────────────────
    {
      id: "break-match-exits-draft",
      label: "```ts<space> — space breaks \\w*, draft dissolves",
      seed: "",
      events: ["`", "`", "`", "t", "s", " "],
      checkpoints: [
        { at: 5, expect: "<g>```</g>ts|" },
        // CONFIDENT: match() returns null → no syntax-hint decoration.
        { at: 6, expect: "```ts |" },
      ],
    },

    // ──────────────────────────────────────────────────────────────
    // 7. Non-line-start ``` should NOT fire (pattern anchored at ^).
    // ──────────────────────────────────────────────────────────────
    {
      id: "non-line-start",
      label: "a``` — backticks not at start of line, no draft",
      seed: "",
      events: ["a", "`", "`", "`"],
      checkpoints: [
        // CONFIDENT: leaveLineDraft.match() sees textContent "a```",
        // regex /^```(\w*)$/ fails → no decoration.
        { at: 4, expect: "a```|" },
      ],
    },

    // Out-of-scope this round (see OPEN QUESTIONS above):
    //   - arrow-leave commit (depends on ArrowUp/Down events)
    //   - autocomplete-click imperative commit (separate unit test)
    //   - lang-input NodeView overlay visibility (no pretty hook)
    //   - Backspace-to-collapse semantics (add once lang NodeView is
    //     sorted — test-pretty interaction with empty code_block + caret
    //     needs Q3 resolved first)
  ],
};
