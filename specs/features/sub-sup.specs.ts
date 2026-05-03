import type { FeatureSpecs } from "../_types.ts";

export const subSupSpecs: FeatureSpecs = {
  name: "sub-sup",
  renderCases: {
    sub: (children) => `<sub>${children}</sub>`,
    sup: (children) => `<sup>${children}</sup>`,
  },
  cases: [
    {
      id: "sub-tilde",
      label: "subscript via single tilde",
      seed: "",
      events: ["~", "x", "~", " "],
      checkpoints: [
        { at: 1, expect: "~|" },
        { at: 2, expect: "~x|" },
        { at: 3, expect: "<g>~</g><sub>x</sub><g>~</g>|" },
        { at: 4, expect: "<sub>x</sub> |" },
      ],
    },
    {
      id: "sup-caret",
      label: "superscript via single caret",
      seed: "",
      events: ["^", "x", "^", " "],
      checkpoints: [
        { at: 1, expect: "^|" },
        { at: 2, expect: "^x|" },
        { at: 3, expect: "<g>^</g><sup>x</sup><g>^</g>|" },
        { at: 4, expect: "<sup>x</sup> |" },
      ],
    },
    {
      id: "strike-wins-over-sub",
      label: "~~x~~ stays strike; sub doesn't fire on ~~ pair",
      seed: "~~x~~ ",
      events: [],
      checkpoints: [
        { at: 0, expect: "<s>x</s> |" },
      ],
    },
  ],
};
