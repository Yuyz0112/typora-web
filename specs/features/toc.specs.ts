import type { FeatureSpecs } from "../_types.ts";

export const tocSpecs: FeatureSpecs = {
  name: "toc",
  renderCases: {
    // Pretty: <toc/> self-closing. The list contents are dynamic (depend
    // on doc headings), so the assertion is presence, not contents.
    div: (children, el) => {
      if (el.classList.contains("toc")) return "<toc/>";
      return children;
    },
  },
  cases: [
    {
      id: "type-toc-enter",
      label: "[toc]<Enter> in an empty doc converts to a toc node",
      seed: "",
      events: ["[", "t", "o", "c", "]", "<Enter>"],
      checkpoints: [
        // auto-pair inserts the closing `]` when `[` lands; subsequent
        // chars type inside the pair, and the explicit `]` skips over.
        { at: 1, expect: "[|]" },
        { at: 4, expect: "[toc|]" },
        { at: 5, expect: "[toc]|" },
        // Enter converts; cursor lands in the trailing fresh paragraph.
        { at: 6, expect: "<toc/>\n|" },
      ],
    },
    {
      id: "TOC-uppercase",
      label: "[TOC]<Enter> works the same as lowercase",
      seed: "",
      events: ["[", "T", "O", "C", "]", "<Enter>"],
      checkpoints: [
        { at: 6, expect: "<toc/>\n|" },
      ],
    },
    {
      id: "non-toc-enter-stays",
      label: "[other]<Enter> doesn't trigger conversion",
      seed: "",
      events: ["[", "o", "t", "h", "e", "r", "]", "<Enter>"],
      checkpoints: [
        // Plain split — paragraph 1 is `[other]`, cursor in fresh para.
        // auto-pair pairs `[` with `]`, then explicit `]` skips over.
        { at: 8, expect: "[other]\n|" },
      ],
    },
    {
      id: "parse-from-seed",
      label: "[toc] in source parses directly to a toc node",
      seed: "# Title\n\n[toc]\n\nbody",
      events: [],
      checkpoints: [
        { at: 0, expect: "<h1>Title</h1>\n<toc/>\nbody|" },
      ],
    },
  ],
};
