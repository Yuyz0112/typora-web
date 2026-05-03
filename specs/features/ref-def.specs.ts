import type { FeatureSpecs } from "../_types.ts";

export const refDefSpecs: FeatureSpecs = {
  name: "ref-def",
  renderCases: {
    "ref-def": (children) => `<ref-def>${children}</ref-def>`,
    "ref-label": (children) => `<rl>${children}</rl>`,
    "ref-url": (children) => `<ru>${children}</ru>`,
    "ref-title": (children) => `<rt>${children}</rt>`,
  },
  cases: [
    {
      id: "type-and-commit",
      label: "[s]: http://x.com<Enter> drafts then commits to structured link_def",
      seed: "",
      events: [
        "[", "s", "]", ":", " ",
        "h", "t", "t", "p", ":", "/", "/", "x", ".", "c", "o", "m",
        "<Enter>",
      ],
      checkpoints: [
        { at: 1, expect: "[|]" },
        { at: 2, expect: "[s|]" },
        { at: 3, expect: "[s]|" },
        { at: 4, expect: "<gi>[</gi>s<gi>]:</gi>|" },
        { at: 5, expect: "<gi>[</gi>s<gi>]:</gi> |" },
        { at: 17, expect: "<gi>[</gi>s<gi>]:</gi> http://x.com|" },
        // Commit: structured node; cursor inside the label.
        {
          at: 18,
          expect:
            "<ref-def><rl>|s</rl><ru>http://x.com</ru><rt></rt></ref-def>",
        },
      ],
    },
    {
      id: "empty-placeholders",
      label: "fresh link_def shows empty url/title slots (placeholders via CSS)",
      // Build via type-and-commit, then leave url empty? Actually we
      // can construct via Enter-inside path: a committed first def +
      // Enter inside it creates a fresh empty one.
      seed: "",
      events: [
        "[", "a", "]", ":", " ", "x", "<Enter>", // commit one
        "<Enter>",                                  // Enter inside → new empty
      ],
      checkpoints: [
        // After first commit (event 7 — auto-pair adds 1 to indices):
        // wait — `[`, `a`, `]`, `:`, ` `, `x`, `<Enter>` is 7 events.
        // After commit cursor is inside the label of the first def.
        {
          at: 7,
          expect:
            "<ref-def><rl>|a</rl><ru>x</ru><rt></rt></ref-def>",
        },
        // Enter while url is filled → new empty link_def below.
        {
          at: 8,
          expect:
            "<ref-def><rl>a</rl><ru>x</ru><rt></rt></ref-def>\n<ref-def><rl>|</rl><ru></ru><rt></rt></ref-def>",
        },
      ],
    },
    {
      id: "empty-enter-deletes",
      label: "Enter on an all-empty link_def removes it",
      seed: "",
      events: [
        "[", "a", "]", ":", " ", "x", "<Enter>", // commit one
        "<Enter>",                                 // chain → empty link_def below
        "<Enter>",                                 // empty + Enter → delete el
      ],
      checkpoints: [
        // After chained Enter (event 8): two link_defs, cursor in 2nd label.
        {
          at: 8,
          expect:
            "<ref-def><rl>a</rl><ru>x</ru><rt></rt></ref-def>\n<ref-def><rl>|</rl><ru></ru><rt></rt></ref-def>",
        },
        // Event 9: Enter on the empty link_def → it's replaced with an
        // empty paragraph; cursor lands inside.
        {
          at: 9,
          expect: "<ref-def><rl>a</rl><ru>x</ru><rt></rt></ref-def>\n|",
        },
      ],
    },
    {
      id: "incomplete-no-commit",
      label: "[s]:<Enter> (no url) — Enter doesn't trigger commit",
      seed: "",
      events: ["[", "s", "]", ":", "<Enter>"],
      checkpoints: [
        { at: 4, expect: "<gi>[</gi>s<gi>]:</gi>|" },
        { at: 5, expect: "<gi>[</gi>s<gi>]:</gi>\n|" },
      ],
    },
    {
      id: "with-title",
      label: '[s]: url "T"<Enter> — title preserved',
      seed: "",
      events: [
        "[", "s", "]", ":", " ", "x", " ", '"', "T", '"', "<Enter>",
      ],
      checkpoints: [
        {
          at: 11,
          expect:
            "<ref-def><rl>|s</rl><ru>x</ru><rt>T</rt></ref-def>",
        },
      ],
    },
  ],
};
