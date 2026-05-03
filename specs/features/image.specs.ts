import type { FeatureSpecs } from "../_types.ts";

export const imageSpecs: FeatureSpecs = {
  name: "image",
  cases: [
    {
      id: "type-image",
      label: "![alt](url) — full typing path with auto-pair",
      seed: "",
      events: [
        "!", "[", "a", "l", "t", "]", "(", "u", "r", "l", ")", " ",
      ],
      checkpoints: [
        { at: 1, expect: "!|" },
        { at: 2, expect: "![|]" },                                  // [ auto-pair
        { at: 5, expect: "![alt|]" },
        { at: 6, expect: "![alt]|" },                               // ] skip-over
        // ( auto-pair → image recognized (empty src), source visible,
        // file-input between ( and ).
        { at: 7, expect: "<img-icon/>![alt](<file-input/>|)" },
        // typing src char hides the file-input; loaded <img> appears
        // BELOW the source (placed at end of span in DOM order).
        { at: 8, expect: "<img-icon/>![alt](u|)<img:u>alt</img>" },
        // ) skip-over keeps cursor on span boundary → still inside.
        // Source visible above, image below; caret at span end (after img
        // in DOM order since img widget has lower side).
        { at: 11, expect: "<img-icon/>![alt](url)<img:url>alt</img>|" },
        // space pushes cursor outside → source hidden, only <img> remains.
        { at: 12, expect: "<img:url>alt</img> |" },
      ],
    },
    {
      id: "empty-alt",
      label: "![](url) — empty alt still recognized; url used as alt fallback",
      seed: "",
      events: ["!", "[", "]", "(", "u", "r", "l", ")", " "],
      checkpoints: [
        { at: 3, expect: "![]|" },
        { at: 4, expect: "<img-icon/>![](<file-input/>|)" },
        { at: 5, expect: "<img-icon/>![](u|)<img:u></img>" },
        { at: 8, expect: "<img-icon/>![](url)<img:url></img>|" },
        // Stable view: empty alt → <img> alt="" → pretty empty children.
        { at: 9, expect: "<img:url></img> |" },
      ],
    },
    {
      id: "leave-and-reenter",
      label: "moving cursor out and back in toggles render/source",
      seed: "",
      events: [
        "!", "[", "a", "]", "(", "u", ")", " ", "<ArrowLeft>",
      ],
      checkpoints: [
        { at: 7, expect: "<img-icon/>![a](u)<img:u>a</img>|" },
        { at: 8, expect: "<img:u>a</img> |" },
        // Cursor moves to boundary `)|<space>` → still inside span, source
        // re-revealed; image still under it.
        { at: 9, expect: "<img-icon/>![a](u)<img:u>a</img>| " },
      ],
    },
  ],
};
