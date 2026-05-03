import type { FeatureSpecs } from "../_types.ts";

export const highlightSpecs: FeatureSpecs = {
  name: "highlight",
  renderCases: {
    mark: (children) => `<mark>${children}</mark>`,
  },
  cases: [
    {
      id: "double-eq",
      label: "highlight via double equals",
      seed: "",
      events: ["=", "=", "k", "=", "=", " "],
      checkpoints: [
        { at: 1, expect: "=|" },
        { at: 2, expect: "==|" },
        { at: 3, expect: "==k|" },
        { at: 4, expect: "==k=|" },
        { at: 5, expect: "<g>==</g><mark>k</mark><g>==</g>|" },
        { at: 6, expect: "<mark>k</mark> |" },
      ],
    },
  ],
};
