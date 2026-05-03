import type { FeatureSpecs } from "../_types.ts";

export const blockquoteSpecs: FeatureSpecs = {
  name: "blockquote",
  cases: [
    {
      id: "immediate-wrap",
      label: "`>` alone stays paragraph; space triggers wrap",
      seed: "",
      events: [">", " ", "a"],
      checkpoints: [
        // at=1: text `>`, plain paragraph.
        { at: 1, expect: ">|" },
        // at=2: space fires the input rule; blockquote with empty
        // paragraph inside, cursor at the start.
        { at: 2, expect: "<bq>|</bq>" },
        // at=3: typed `a` inside the blockquote paragraph.
        { at: 3, expect: "<bq>a|</bq>" },
      ],
    },

    {
      id: "content-can-start-with-space",
      label: "first content char can be a space",
      seed: "",
      events: [">", " ", " "],
      checkpoints: [
        { at: 2, expect: "<bq>|</bq>" },
        { at: 3, expect: "<bq> |</bq>" },
      ],
    },

    {
      id: "non-space-first-content",
      label: "first content char can be any non-space (e.g. `x`)",
      seed: "",
      events: [">", " ", "x"],
      checkpoints: [
        { at: 3, expect: "<bq>x|</bq>" },
      ],
    },

    {
      id: "enter-extends",
      label: "Enter inside non-empty blockquote line → new blockquote line",
      seed: "",
      events: [">", " ", "a", "<Enter>", "b"],
      checkpoints: [
        { at: 3, expect: "<bq>a|</bq>" },
        { at: 4, expect: "<bq>a\n|</bq>" },
        { at: 5, expect: "<bq>a\nb|</bq>" },
      ],
    },

    {
      id: "enter-on-empty-line-exits",
      label: "Enter on an empty blockquote line → exit blockquote",
      seed: "",
      events: [">", " ", "a", "<Enter>", "<Enter>"],
      checkpoints: [
        { at: 4, expect: "<bq>a\n|</bq>" },
        { at: 5, expect: "<bq>a</bq>\n|" },
      ],
    },

    {
      id: "mid-line-enter-splits",
      label: "Enter in the middle of a blockquote line → split, both halves stay inside",
      seed: "> ab",
      events: ["<Home>", "<ArrowRight>", "<Enter>"],
      checkpoints: [
        { at: 3, expect: "<bq>a\n|b</bq>" },
      ],
    },
  ],
};
