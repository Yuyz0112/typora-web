import type { FeatureSpecs } from "../_types.ts";

export const hrSpecs: FeatureSpecs = {
  name: "horizontal_rule",
  cases: [
    {
      // Lead with a paragraph + an Enter so `---` lands in the SECOND
      // paragraph. At doc-start, `---<Enter>` is owned by front-matter
      // (opens a yaml block), not hr — the seed-trailing-newlines path
      // doesn't survive the parser (md collapses blank lines), hence the
      // explicit Enter event.
      id: "dashes-commit-on-enter",
      label: "--- + Enter → HR (away from doc start)",
      seed: "a",
      events: ["<Enter>", "-", "-", "-", "<Enter>"],
      checkpoints: [
        { at: 1, expect: "a\n|" },
        { at: 4, expect: "a\n<g>---</g>|" },
        { at: 5, expect: "a\n<hr/>\n|" },
      ],
    },
    {
      id: "asterisks-commit-on-enter",
      label: "*** + Enter → HR (asterisk variant)",
      seed: "",
      events: ["*", "*", "*", "<Enter>"],
      checkpoints: [
        { at: 3, expect: "<g>***</g>|" },
        { at: 4, expect: "<hr/>\n|" },
      ],
    },
    {
      id: "underscores-commit-on-enter",
      label: "___ + Enter → HR (underscore variant)",
      seed: "",
      events: ["_", "_", "_", "<Enter>"],
      checkpoints: [
        { at: 3, expect: "<g>___</g>|" },
        { at: 4, expect: "<hr/>\n|" },
      ],
    },
    {
      id: "fourth-char-drops-draft",
      label: "---a — a 4th char breaks the match, no more draft",
      seed: "",
      events: ["-", "-", "-", "a"],
      checkpoints: [
        { at: 3, expect: "<g>---</g>|" },
        { at: 4, expect: "---a|" },
      ],
    },
    {
      id: "not-at-line-start",
      label: "a--- — delims not at line start, never a draft",
      seed: "",
      events: ["a", "-", "-", "-", "<Enter>"],
      checkpoints: [
        { at: 4, expect: "a---|" },
        { at: 5, expect: "a---\n|" },
      ],
    },
  ],
};
