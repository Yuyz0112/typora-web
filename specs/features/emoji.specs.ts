import type { FeatureSpecs } from "../_types.ts";

export const emojiSpecs: FeatureSpecs = {
  name: "emoji",
  cases: [
    {
      id: "type-smile",
      label: ":smile: typed char by char — emoji renders on closing `:`",
      seed: "",
      events: [":", "s", "m", "i", "l", "e", ":", " "],
      checkpoints: [
        // `:` alone — partial is empty, dropdown stays closed.
        { at: 1, expect: ":|" },
        // From `:s` onwards the dropdown opens (PARTIAL_RE matches +
        // at least one known name has the prefix).
        { at: 2, expect: ":s|<select />" },
        { at: 3, expect: ":sm|<select />" },
        { at: 4, expect: ":smi|<select />" },
        { at: 5, expect: ":smil|<select />" },
        { at: 6, expect: ":smile|<select />" },
        // Closing `:` lands; PARTIAL_RE no longer matches → dropdown
        // closes. The inline scanner kicks in and renders the glyph
        // with the source chars as a gray hint (cursor at right edge).
        { at: 7, expect: "😄<g>:smile:</g>|" },
        { at: 8, expect: "😄 |" },
      ],
    },
    {
      id: "unknown-name-stays-text",
      label: ":notarealname: — unknown name stays as plain text",
      seed: ":notarealname: ",
      events: [],
      checkpoints: [
        { at: 0, expect: ":notarealname: |" },
      ],
    },
    {
      id: "parse-from-seed",
      label: "<seed> :rocket: ships → renders glyph, source hidden (cursor at end)",
      seed: ":rocket: ships",
      events: [],
      checkpoints: [
        { at: 0, expect: "🚀 ships|" },
      ],
    },
  ],
};
