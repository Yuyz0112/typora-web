import type { FeatureSpec } from "./_types.ts";

// Heading feature — test-case STUB.
//
// Implementation will use `src/block-draft.ts`: while the cursor is in a
// paragraph whose text matches /^(#{1,6}) (.+)/, the paragraph enters a
// "draft heading" state — `# ` prefix gets `syntax-hint` inline deco
// (gray `<g># </g>`), content gets a bold/heading draft class but stays
// at paragraph font size. When the cursor leaves the line (Enter / click
// / arrow across block boundary), the draft commits to a real heading
// node of level = #-count; that commit is one-way (re-entering an
// already-rendered heading does NOT return to draft).
//
// ─────────────────────────────────────────────────────────────────────────────
// OPEN QUESTIONS (flagged for implementor / reviewer; do not silently fix)
// ─────────────────────────────────────────────────────────────────────────────
//
// Q1. test-pretty heading ambiguity.
//   Current `test-pretty.ts` renders <h1> as the literal string `# content`
//   (`${"#".repeat(level)} ${children}`). That collides 1:1 with a plain
//   paragraph whose text is `# content` — the committed/rendered state is
//   visually indistinguishable from the "not entered" state, and from the
//   draft state if we stripped the <g># </g> hint.
//
//   Proposal: change the heading renderCase (either via a feature
//   renderCase entry, or by editing the switch in test-pretty) to wrap the
//   children in the tag instead of synthesising a `#` prefix, i.e.
//     <h1>content</h1> ... <h6>content</h6>
//   This is consistent with how <em>/<strong>/<a> are rendered (tag wraps
//   content) and removes the ambiguity.
//
//   The cases below are written ASSUMING this change has landed. Each case
//   that depends on it is tagged in its comment with "DEPENDS ON pretty
//   change (Q1)". They will fail today both because the feature is not
//   implemented AND because pretty still emits the `# ` prefix form — the
//   Q1 change needs to ship before the commit-state assertions can go
//   green on their own.
//
// Q2. Events missing for arrow-up/down.
//   Two desirable cases are not writable today because `src/events.ts`
//   doesn't define `<ArrowUp>` / `<ArrowDown>`:
//     - "leaving the line by arrow-up commits draft to heading"
//     - "re-entering an already-rendered heading line stays rendered
//        (one-way transition)"
//   These are flagged in cases[].label with "SKIPPED (no ArrowUp/Down)".
//   Adding them to events.ts is a one-liner; revisit after that lands.
//
// Q3. Empty-heading backspace case.
//   "Render a heading with no content, Backspace twice → paragraph" needs
//   a seed that parses into a real heading node. Using `seed: "# "` only
//   yields a paragraph (pattern requires `^#{1,6} .+`, i.e. non-empty
//   content), so there is no md string that produces an empty <h1> via the
//   normal parser. The spec says "serialize looks at the heading node's
//   level attr", so the round-trip `# ` exists on the serialise side but
//   not the parse side. Workaround options:
//     a) seed with non-empty content (`"# a"`) then delete `a` first, then
//        test double-Backspace. This keeps us honest about parse path.
//     b) extend test-utils `setup()` to accept a pre-built doc / JSON.
//   Case below uses (a) and notes the compromise.
//
// Q4. "Draft + Enter cursor position".
//   After commit, PM inserts a new paragraph below the heading and puts
//   the cursor there. pretty for two stacked blocks joins with `\n`. The
//   new-paragraph block is empty — with the trailing-break filter it
//   renders as an empty string, so the block join produces `...\n`. The
//   caret widget lives INSIDE the empty paragraph, so pretty should show
//   `<h1>a</h1>\n|`. Verify this matches block-draft's actual commit
//   behaviour (does it create a new paragraph, or move cursor to start of
//   the following existing block?). If the commit does NOT create a
//   trailing paragraph when there is none, these `\n|` endings need
//   adjustment.
//
// Q5. Draft ↔ not-entered toggle on `#` deletion.
//   Spec says "delete `#` → back to not-entered". Two interpretations:
//     i)  deletion of the space after `#` (text becomes `#a`) breaks the
//         pattern → exits draft
//     ii) deletion of `#` itself (text becomes ` a` with leading space) →
//         exits draft
//   Both are "text no longer matches ^#{1,6} .+", so block-draft should
//   drop the deco purely as a function of text. Case #4 below exercises
//   (i). (ii) is implicit — same mechanism.
//
// Q6. "Active + type # at line start raises level" — case #5 below.
//   Assumes block-draft recomputes `level = #-count` every transaction,
//   which is the natural reading of "match is pure function of text".
//   If implementor caches level, this case will catch it.
//
// ─────────────────────────────────────────────────────────────────────────────

export const heading: FeatureSpec = {
  name: "heading",

  cases: [
    {
      id: "type-and-commit-h1",
      label: "# a<Enter> — typing draft then commit to <h1>",
      seed: "",
      events: ["#", " ", "a", "<Enter>"],
      checkpoints: [
        // `#` alone: not entered (needs ` ` + content).
        { at: 1, expect: "#|" },
        // `# `: still not entered (pattern requires non-empty content).
        { at: 2, expect: "# |" },
        // `# a`: draft active — `# ` gets syntax-hint deco, content visible.
        { at: 3, expect: "<g># </g>a|" },
        // Enter commits the draft to a real heading; caret lands in a new
        // paragraph below. DEPENDS ON pretty change (Q1) — `<h1>a</h1>`
        // instead of `# a`. Trailing newline + caret: see Q4.
        { at: 4, expect: "<h1>a</h1>\n|" },
      ],
    },

    {
      id: "type-and-commit-h3",
      label: "### x<Enter> — level N picked from #-count",
      seed: "",
      events: ["#", "#", "#", " ", "x", "<Enter>"],
      checkpoints: [
        { at: 3, expect: "###|" },          // not entered
        { at: 4, expect: "### |" },         // still not entered (empty content)
        { at: 5, expect: "<g>### </g>x|" }, // draft
        { at: 6, expect: "<h3>x</h3>\n|" }, // commit. DEPENDS ON pretty change (Q1)
      ],
    },

    {
      id: "hash-space-enter-stays-paragraph",
      label: "# <Enter> — never entered draft, Enter does not commit",
      seed: "",
      events: ["#", " ", "<Enter>"],
      checkpoints: [
        { at: 2, expect: "# |" },
        // Enter on a "not entered" paragraph splits normally: two
        // paragraphs, caret at start of the second.
        { at: 3, expect: "# \n|" },
      ],
    },

    {
      id: "backspace-exits-draft",
      label: "# a + two Backspaces — draft exits, then `#` removed",
      seed: "",
      events: ["#", " ", "a", "<Backspace>", "<Backspace>"],
      checkpoints: [
        { at: 3, expect: "<g># </g>a|" },   // draft
        // Delete `a` → text is `# ` → pattern requires non-empty
        // content → pattern fails → draft exits → plain paragraph.
        { at: 4, expect: "# |" },
        // Delete the space → text is `#` → still paragraph, no deco.
        { at: 5, expect: "#|" },
      ],
    },

    {
      id: "raise-level-by-prepending-hash",
      label: "seed `# a`, <Home>#  — in-draft, prepending # raises level 1→2",
      seed: "# a",
      events: ["<Home>", "#"],
      checkpoints: [
        // Seed parses as a real <h1> via markdown-it (committed, not draft).
        // DEPENDS ON pretty change (Q1).
        //
        // NOTE: if we want the seed to land in DRAFT state rather than
        // rendered, the seed needs to come in via a different path
        // (block-draft only activates when cursor is in a paragraph).
        // Parser produces a heading node for `# a`, so the `at: 0`
        // checkpoint reflects the committed form. The `<Home>` + `#` are
        // therefore operating on a rendered heading, not a draft. This
        // case is kept to exercise "typing into a rendered heading" —
        // behaviour TBD by implementor. Mark as DEPENDS ON spec
        // clarification until then.
        //
        // If instead we want to test draft-level bumping, seed needs to be
        // something that lands in draft — requires a way to seed a
        // paragraph with text `# a` (bypass parser). See Q3 option (b).
        { at: 0, expect: "<h1>a</h1>" },
      ],
    },

    {
      id: "commit-then-type",
      label: "# a<Enter>x — caret is in new paragraph after commit",
      seed: "",
      events: ["#", " ", "a", "<Enter>", "x"],
      checkpoints: [
        { at: 3, expect: "<g># </g>a|" },
        { at: 4, expect: "<h1>a</h1>\n|" },   // DEPENDS ON pretty change (Q1) + Q4
        { at: 5, expect: "<h1>a</h1>\nx|" },  // DEPENDS ON pretty change (Q1) + Q4
      ],
    },

    // ─────────────────────────────────────────────────────────────────────
    // Cases SKIPPED for now — flagged with reason. Intentionally empty
    // checkpoints arrays so runFeatureCases still enumerates them in the
    // harness but emits no assertions. Flip these on once the blocker
    // lifts.
    // ─────────────────────────────────────────────────────────────────────

    {
      id: "rendered-reentry-stays-rendered",
      label:
        "SKIPPED (no ArrowUp/Down in events.ts — Q2) — re-entering an " +
        "already-rendered heading line stays rendered; does NOT re-enter draft",
      seed: "",
      events: [],
      checkpoints: [],
    },

    {
      id: "arrow-leave-commits",
      label:
        "SKIPPED (no ArrowUp/Down in events.ts — Q2) — leaving the line by " +
        "ArrowDown from draft commits to heading just like <Enter> does",
      seed: "",
      events: [],
      checkpoints: [],
    },

    {
      id: "empty-heading-double-backspace",
      label:
        "SKIPPED (no md that parses to empty heading — Q3) — a committed " +
        "heading whose content is deleted then Backspace again unwraps to " +
        "paragraph. Reactivate once test-utils grows a JSON-seed path.",
      seed: "",
      events: [],
      checkpoints: [],
    },
  ],
};
