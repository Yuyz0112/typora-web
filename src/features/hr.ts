import type { FeatureSpec } from "./_types.ts";

// horizontal_rule (HR).
//
// Commit timing = leave-line. While the cursor is still on the line
// containing exactly `---` (or `***` / `___`), the line stays a regular
// paragraph but the three delim chars render gray (`<g>---</g>`) as a
// draft hint. Only when the selection leaves that line (Enter, Arrow
// up/down, click elsewhere) does the paragraph get replaced with an
// `horizontal_rule` node.
//
// Adding a 4th char (or anything that breaks the `^[-*_]{3}$` match)
// should drop the draft immediately — it's back to plain text.
//
// OPEN QUESTIONS:
//   - pretty has `<hr>` → `"---"` and paragraph text `"---"` → `"---"`,
//     so the pre-commit and post-commit block forms look identical in
//     isolation. We distinguish them via the cursor position:
//       pre-commit  (draft):  `<g>---</g>|`           (caret in the
//                                                      paragraph, delims
//                                                      are a gray hint)
//       post-commit (HR):     `---\n|`                (a new empty
//                                                      paragraph below
//                                                      the HR holds the
//                                                      caret)
//     If this is still ambiguous once implemented, we may need to flag
//     test-pretty to mark HR nodes differently (e.g. `<hr/>`). Flagged
//     but not acted on in this stub.
//   - `<ArrowUp>` / `<ArrowDown>` are NOT currently handled by the
//     event DSL (see events.ts). Typora also commits HR on Arrow leave,
//     but we can only reach that with Enter in these tests. Arrow-leave
//     cases deferred.
//   - After Enter-commit, does the cursor land in a brand new empty
//     paragraph under the HR (Typora behaviour), or stay on the line
//     that just became the HR? Assumed: new empty paragraph below.
//   - HR is selectable via arrow / click. Selection rendering (the
//     focus indicator) isn't expressible in pretty today — not covered.
export const hr: FeatureSpec = {
  name: "horizontal_rule",

  cases: [
    {
      id: "dashes-commit-on-enter",
      label: "--- + Enter → HR",
      seed: "",
      events: ["-", "-", "-", "<Enter>"],
      checkpoints: [
        // at 2: two dashes — not yet a draft HR, plain text.
        { at: 2, expect: "--|" },
        // at 3: three dashes, cursor still on the line → draft hint.
        { at: 3, expect: "<g>---</g>|" },
        // at 4: Enter committed the HR; caret lives in a fresh empty
        // paragraph below. See OPEN QUESTIONS for the post-commit
        // cursor assumption.
        { at: 4, expect: "---\n|" },
      ],
    },
    {
      id: "asterisks-commit-on-enter",
      label: "*** + Enter → HR (asterisk variant)",
      seed: "",
      events: ["*", "*", "*", "<Enter>"],
      checkpoints: [
        // at 3: bare `***` on an empty line — HR draft, not an
        // emphasis pair (no content between the runs).
        { at: 3, expect: "<g>***</g>|" },
        { at: 4, expect: "---\n|" },
      ],
    },
    {
      id: "underscores-commit-on-enter",
      label: "___ + Enter → HR (underscore variant)",
      seed: "",
      events: ["_", "_", "_", "<Enter>"],
      checkpoints: [
        { at: 3, expect: "<g>___</g>|" },
        { at: 4, expect: "---\n|" },
      ],
    },
    {
      id: "fourth-char-drops-draft",
      label: "---a — a 4th char breaks the match, no more draft",
      seed: "",
      events: ["-", "-", "-", "a"],
      checkpoints: [
        // at 3: draft active.
        { at: 3, expect: "<g>---</g>|" },
        // at 4: text no longer matches `^[-*_]{3}$`, delims go back to
        // plain chars (no gray hint).
        { at: 4, expect: "---a|" },
      ],
    },
    {
      id: "not-at-line-start",
      label: "a--- — delims not at line start, never a draft",
      seed: "",
      events: ["a", "-", "-", "-", "<Enter>"],
      checkpoints: [
        // at 4: content is `a---`, which never matches the HR shape —
        // no draft hint at any point.
        { at: 4, expect: "a---|" },
        // Enter just inserts a new paragraph; no HR is produced.
        { at: 5, expect: "a---\n|" },
      ],
    },
  ],
};
