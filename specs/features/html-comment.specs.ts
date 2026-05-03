import type { FeatureSpecs } from "../_types.ts";

export const htmlCommentSpecs: FeatureSpecs = {
  name: "html-comment",
  renderCases: {
    "mark-comment": (children) => `<comment>${children}</comment>`,
  },
  cases: [
    {
      id: "type-comment",
      label: "<!--x--> typed char by char triggers on closing `-->`",
      seed: "",
      events: ["<", "!", "-", "-", "x", "-", "-", ">", " "],
      checkpoints: [
        { at: 1, expect: "<|" },
        { at: 2, expect: "<!|" },
        { at: 3, expect: "<!-|" },
        { at: 4, expect: "<!--|" },
        { at: 5, expect: "<!--x|" },
        { at: 6, expect: "<!--x-|" },
        { at: 7, expect: "<!--x--|" },
        { at: 8, expect: "<comment><!--x--></comment>|" },
        { at: 9, expect: "<comment><!--x--></comment> |" },
      ],
    },
    {
      id: "parse-from-seed",
      label: "<!--note--> in source preserves through parse",
      seed: "<!--note--> ",
      events: [],
      checkpoints: [
        { at: 0, expect: "<comment><!--note--></comment> |" },
      ],
    },
    {
      id: "inline-amid-text",
      label: "comment between text — surrounding paragraph stays plain",
      seed: "before <!--x--> after",
      events: [],
      checkpoints: [
        {
          at: 0,
          expect: "before <comment><!--x--></comment> after|",
        },
      ],
    },
  ],
};
