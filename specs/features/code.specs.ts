import type { FeatureSpecs } from "../_types.ts";

export const codeSpecs: FeatureSpecs = {
  name: "code",
  renderCases: {
    code: (children) => `<c>${children}</c>`,
  },
  cases: [
    {
      id: "backticks",
      label: "inline code via single backticks",
      seed: "",
      events: ["`", "1", "`", " "],
      checkpoints: [
        { at: 1, expect: "`|" },
        { at: 2, expect: "`1|" },
        { at: 3, expect: "<g>`</g><c>1</c><g>`</g>|" },
        { at: 4, expect: "<c>1</c> |" },
      ],
    },
    {
      id: "double-backtick-basic",
      label: "``x`` — double-backtick fence around plain content",
      seed: "",
      events: ["`", "`", "x", "`", "`", " "],
      checkpoints: [
        { at: 2, expect: "``|" },
        { at: 3, expect: "``x|" },
        // step 5: 2-backtick open + 2-backtick close → fence fires
        { at: 5, expect: "<g>``</g><c>x</c><g>``</g>|" },
        { at: 6, expect: "<c>x</c> |" },
      ],
    },
    {
      id: "double-backtick-embedded-backtick",
      label: "`` ` `` — double-backtick fence wrapping a single backtick",
      seed: "",
      events: ["`", "`", " ", "`", " ", "`", "`", " "],
      checkpoints: [
        { at: 1, expect: "`|" },
        { at: 2, expect: "``|" },
        { at: 3, expect: "`` |" },
        // step 4: a 1-char close lands. Even though the open run is 2-long,
        // Typora fires a 1-char fence using one of those backticks, leaving
        // the other as the code-marked content. The trailing space inside
        // is a soft range — visible while the cursor is inside the span.
        { at: 4, expect: "<g>`</g><c>`</c> <g>`</g>|" },
        // step 5: cursor moves past trailing space → outside span → delim
        // and soft space hidden, only the code-styled backtick + the
        // post-span trailing space remain.
        { at: 5, expect: "<c>`</c> |" },
        // step 6: another `   typed after the trailing space — outside the
        // existing 1-char fence, so it shows as plain text.
        { at: 6, expect: "<c>`</c> `|" },
        // step 7: the 2-char close run that finally lands re-pairs with the
        // 2-char open run as a 2-char fence; the leading + trailing space
        // are soft ranges inside the span (visible since cursor is inside).
        { at: 7, expect: "<g>``</g> <c>`</c> <g>``</g>|" },
        // step 8: cursor moves past the new trailing space → outside span
        // → soft + delim hidden.
        { at: 8, expect: "<c>`</c> |" },
      ],
    },
  ],
};
