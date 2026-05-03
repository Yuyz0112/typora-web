import type { FeatureSpecs } from "../_types.ts";

export const strikeSpecs: FeatureSpecs = {
  name: "strike",
  renderCases: {
    s: (children) => `<s>${children}</s>`,
    del: (children) => `<s>${children}</s>`,
  },
  cases: [
    {
      id: "double-tilde",
      label: "strike via double tildes",
      seed: "",
      events: ["~", "~", "1", "~", "~", " "],
      checkpoints: [
        { at: 2, expect: "~~|" },
        { at: 3, expect: "~~1|" },
        { at: 5, expect: "<g>~~</g><s>1</s><g>~~</g>|" },
        { at: 6, expect: "<s>1</s> |" },
      ],
    },
  ],
};
