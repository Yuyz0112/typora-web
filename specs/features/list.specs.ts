import type { FeatureSpecs } from "../_types.ts";

export const listSpecs: FeatureSpecs = {
  name: "bullet_list",
  cases: [
    // ── 1. immediate wrap on space ──────────────────────────────────────
    {
      id: "dash-space-wraps",
      label: "`- ` (dash + space) wraps current paragraph into a bullet list",
      seed: "",
      events: ["-", " "],
      checkpoints: [
        { at: 1, expect: "-|" },
        { at: 2, expect: "<ul><li>|</li></ul>" },
      ],
    },

    // ── 2. non-space does NOT trigger ───────────────────────────────────
    {
      id: "dash-char-no-wrap",
      label: "`-a` (dash + letter, no space) stays in a paragraph",
      seed: "",
      events: ["-", "a"],
      checkpoints: [
        { at: 2, expect: "-a|" },
      ],
    },

    // ── 3. typing content after wrap ────────────────────────────────────
    {
      id: "type-after-wrap",
      label: "typed content after `- ` trigger lives inside the list_item",
      seed: "",
      events: ["-", " ", "a"],
      checkpoints: [
        { at: 2, expect: "<ul><li>|</li></ul>" },
        { at: 3, expect: "<ul><li>a|</li></ul>" },
      ],
    },

    // ── 4. Enter creates a new sibling item ─────────────────────────────
    {
      id: "enter-splits-item",
      label: "Enter in a non-empty item splits into a new empty sibling",
      seed: "",
      events: ["-", " ", "a", "<Enter>", "b"],
      checkpoints: [
        { at: 3, expect: "<ul><li>a|</li></ul>" },
        { at: 4, expect: "<ul><li>a</li><li>|</li></ul>" },
        { at: 5, expect: "<ul><li>a</li><li>b|</li></ul>" },
      ],
    },

    // ── 5. top-level empty item + Enter → exit list to paragraph ────────
    {
      id: "enter-on-empty-exits",
      label: "Enter on an empty top-level item exits the list (liftListItem)",
      seed: "",
      events: ["-", " ", "a", "<Enter>", "<Enter>"],
      checkpoints: [
        { at: 4, expect: "<ul><li>a</li><li>|</li></ul>" },
        // empty item lifted out → one-item list, then sibling empty
        // paragraph (block children separated by "\n").
        { at: 5, expect: "<ul><li>a</li></ul>\n|" },
      ],
    },

    // ── 6. Nest via Tab ─────────────────────────────────────────────────
    {
      id: "tab-sinks-item",
      label: "Tab on a second item sinks it into a nested list under the first",
      seed: "- a",
      events: ["<Enter>", "<Tab>", "b"],
      checkpoints: [
        { at: 1, expect: "<ul><li>a</li><li>|</li></ul>" },
        { at: 2, expect: "<ul><li>a<ul><li>|</li></ul></li></ul>" },
        { at: 3, expect: "<ul><li>a<ul><li>b|</li></ul></li></ul>" },
      ],
    },

    // ── 7. Nested staircase exit ────────────────────────────────────────
    {
      id: "digit-dot-space-wraps",
      label: "`1. ` wraps current paragraph into an ordered list (start = 1)",
      seed: "",
      events: ["1", ".", " "],
      checkpoints: [
        { at: 2, expect: "1.|" },
        { at: 3, expect: "<ol><li>|</li></ol>" },
      ],
    },
    {
      id: "ol-non-1-start",
      label: "`5. ` wraps with start=5; serializer emits 5./6./7.",
      seed: "",
      events: ["5", ".", " ", "a", "<Enter>", "b"],
      checkpoints: [
        { at: 3, expect: "<ol s=5><li>|</li></ol>" },
        { at: 4, expect: "<ol s=5><li>a|</li></ol>" },
        { at: 5, expect: "<ol s=5><li>a</li><li>|</li></ol>" },
        { at: 6, expect: "<ol s=5><li>a</li><li>b|</li></ol>" },
      ],
    },
    {
      id: "ol-parse-roundtrip",
      label: "Ordered list parses from `1. a\\n2. b` and round-trips",
      seed: "1. a\n2. b\n3. c",
      events: [],
      checkpoints: [
        { at: 0, expect: "<ol><li>a</li><li>b</li><li>c|</li></ol>" },
      ],
    },
    {
      id: "lone-empty-enter-creates-sibling",
      label: "Enter on a lone empty top-level item creates a new sibling (matches task list)",
      seed: "",
      events: ["-", " ", "<Enter>", "<Enter>"],
      checkpoints: [
        { at: 2, expect: "<ul><li>|</li></ul>" },
        // First Enter creates a new sibling rather than exiting (was: exit immediately).
        { at: 3, expect: "<ul><li></li><li>|</li></ul>" },
        // Second Enter on the now-with-prev empty exits.
        { at: 4, expect: "<ul><li></li></ul>\n|" },
      ],
    },
    {
      id: "staircase-exit",
      label: "Nested empty item + repeated Enter: 3-step Typora staircase",
      seed: "- a\n  - b",
      events: ["<Enter>", "<Enter>", "<Enter>", "<Enter>"],
      checkpoints: [
        { at: 1, expect: "<ul><li>a<ul><li>b</li><li>|</li></ul></li></ul>" },
        // bulletless intermediate: nested ul closes, <li-tail> sits inside
        // the outer li.
        { at: 2, expect: "<ul><li>a<ul><li>b</li></ul><li-tail>|</li-tail></li></ul>" },
        // promote to outer sibling.
        { at: 3, expect: "<ul><li>a<ul><li>b</li></ul></li><li>|</li></ul>" },
        // exit list entirely.
        { at: 4, expect: "<ul><li>a<ul><li>b</li></ul></li></ul>\n|" },
      ],
    },
    {
      id: "backspace-from-empty-para-below-list",
      label: "Backspace in empty trailing para below a list jumps to deepest last textblock",
      seed: "- a\n  - b",
      events: [
        "<Enter>", "<Enter>", "<Enter>", "<Enter>", // staircase to empty para
        "<Backspace>",
      ],
      checkpoints: [
        { at: 4, expect: "<ul><li>a<ul><li>b</li></ul></li></ul>\n|" },
        // PM's default would lift the empty para into a sibling outer
        // list_item. Typora's behavior — and ours — is: the empty para
        // is deleted and the cursor lands at the end of the deepest
        // last textblock in the previous list (here `b`).
        { at: 5, expect: "<ul><li>a<ul><li>b|</li></ul></li></ul>" },
      ],
    },

  ],
};
