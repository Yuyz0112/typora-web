import type { FeatureSpecs } from "../_types.ts";

export const autoPairSpecs: FeatureSpecs = {
  name: "auto_pair",
  cases: [
    {
      id: "bracket-at-eol",
      label: "[ at end of line auto-pairs to []",
      seed: "",
      events: ["["],
      checkpoints: [{ at: 1, expect: "[|]" }],
    },
    {
      id: "paren-at-eol",
      label: "( at end of line auto-pairs to ()",
      seed: "",
      events: ["("],
      checkpoints: [{ at: 1, expect: "(|)" }],
    },
    {
      id: "bracket-before-space",
      label: "[ before space still auto-pairs",
      seed: "",
      events: [" ", "<Home>", "["],
      checkpoints: [{ at: 3, expect: "[|] " }],
    },
    {
      id: "bracket-before-letter-no-pair",
      label: "[ before a letter does NOT auto-pair",
      seed: "",
      events: ["a", "b", "<ArrowLeft>", "["],
      checkpoints: [
        { at: 3, expect: "a|b" },
        { at: 4, expect: "a[|b" },
      ],
    },
    {
      id: "backspace-empties-bracket-pair",
      label: "Backspace inside empty [] removes both chars",
      seed: "",
      events: ["[", "<Backspace>"],
      checkpoints: [
        { at: 1, expect: "[|]" },
        { at: 2, expect: "|" },
      ],
    },
    {
      id: "backspace-empties-paren-pair",
      label: "Backspace inside empty () removes both chars",
      seed: "",
      events: ["(", "<Backspace>"],
      checkpoints: [
        { at: 1, expect: "(|)" },
        { at: 2, expect: "|" },
      ],
    },
    {
      id: "skip-over-closing-bracket",
      label: "] inside [|] skips past, no duplicate",
      seed: "",
      events: ["[", "]"],
      checkpoints: [
        { at: 1, expect: "[|]" },
        { at: 2, expect: "[]|" },
      ],
    },
    {
      id: "skip-over-closing-paren",
      label: ") inside (|) skips past, no duplicate",
      seed: "",
      events: ["(", ")"],
      checkpoints: [
        { at: 1, expect: "(|)" },
        { at: 2, expect: "()|" },
      ],
    },
    {
      id: "natural-link-typing",
      label: "[a](b) types end-to-end with no stranded chars",
      seed: "",
      events: ["[", "a", "]", "(", "b", ")"],
      checkpoints: [
        { at: 3, expect: "[a]|" },
        // at 4: empty href `[a]()` is a valid link, fires immediately.
        { at: 4, expect: "<g>[</g><l:>a</l><g>](</g>|<g>)</g>" },
        { at: 6, expect: "<g>[</g><l:b>a</l><g>](b)</g>|" },
      ],
    },
    {
      id: "skip-over-only-when-match",
      label: "] before non-] inserts as-is",
      seed: "",
      events: ["a", "]"],
      checkpoints: [{ at: 2, expect: "a]|" }],
    },
    {
      id: "backspace-keeps-pair-when-content",
      label: "Backspace inside [x] only removes the [",
      seed: "",
      events: ["[", "x", "<ArrowLeft>", "<Backspace>"],
      checkpoints: [
        { at: 2, expect: "[x|]" },
        { at: 3, expect: "[|x]" },
        { at: 4, expect: "|x]" },
      ],
    },
  ],
};
