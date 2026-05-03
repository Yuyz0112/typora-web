import type { FeatureSpecs } from "../_types.ts";

export const taskSpecs: FeatureSpecs = {
  name: "task",
  cases: [
    {
      id: "type-from-scratch",
      label: "- [ ] a — full typing path",
      seed: "",
      events: ["-", " ", "[", " ", "]", " ", "a"],
      checkpoints: [
        { at: 1, expect: "-|" },
        { at: 2, expect: "<ul><li>|</li></ul>" },
        { at: 3, expect: "<ul><li>[|]</li></ul>" },
        { at: 4, expect: "<ul><li>[ |]</li></ul>" },
        { at: 5, expect: "<ul><li>[ ]|</li></ul>" },
        { at: 6, expect: "<ul><li><checkbox/>|</li></ul>" },
        { at: 7, expect: "<ul><li><checkbox/>a|</li></ul>" },
      ],
    },
    {
      id: "checked-form",
      label: "- [x] done — checked variant",
      seed: "",
      events: ["-", " ", "[", "x", "]", " ", "d", "o", "n", "e"],
      checkpoints: [
        { at: 5, expect: "<ul><li>[x]|</li></ul>" },
        { at: 6, expect: "<ul><li><checkbox checked/>|</li></ul>" },
        { at: 10, expect: "<ul><li><checkbox checked/>done|</li></ul>" },
      ],
    },
    {
      id: "enter-propagates-marker",
      label: "Enter after task content seeds a new task sibling",
      seed: "",
      events: ["-", " ", "[", " ", "]", " ", "a", "<Enter>", "b"],
      checkpoints: [
        { at: 7, expect: "<ul><li><checkbox/>a|</li></ul>" },
        { at: 8, expect: "<ul><li><checkbox/>a</li><li><checkbox/>|</li></ul>" },
        { at: 9, expect: "<ul><li><checkbox/>a</li><li><checkbox/>b|</li></ul>" },
      ],
    },
    {
      id: "single-empty-enter-propagates",
      label: "Enter on a lone empty task creates another empty task",
      seed: "- [ ] ",
      events: ["<Enter>"],
      checkpoints: [
        { at: 0, expect: "<ul><li><checkbox/>|</li></ul>" },
        { at: 1, expect: "<ul><li><checkbox/></li><li><checkbox/>|</li></ul>" },
      ],
    },
    {
      id: "two-empty-enter-exits",
      label: "Enter on the second of two empty tasks exits to plain paragraph",
      // Build the state via typing rather than seed (parser would also work).
      seed: "",
      events: [
        "-", " ", "[", " ", "]", " ", // first task
        "<Enter>",                    // propagate → 2nd empty task
        "<Enter>",                    // exit
      ],
      checkpoints: [
        { at: 6, expect: "<ul><li><checkbox/>|</li></ul>" },
        { at: 7, expect: "<ul><li><checkbox/></li><li><checkbox/>|</li></ul>" },
        { at: 8, expect: "<ul><li><checkbox/></li></ul>\n|" },
      ],
    },
    {
      id: "deep-nested-staircase",
      label: "3-level nested empty task: each Enter peels off one level (with marker propagation)",
      seed: "- [ ] A\n  - [ ] B\n    - [ ] C\n    - [ ] ",
      events: ["<Enter>", "<Enter>", "<Enter>", "<Enter>", "<Enter>"],
      checkpoints: [
        {
          at: 0,
          expect:
            "<ul><li><checkbox/>A<ul><li><checkbox/>B<ul><li><checkbox/>C</li><li><checkbox/>|</li></ul></li></ul></li></ul>",
        },
        // E1: level-3 marker-only → bulletless tail inside level-2 li(B).
        {
          at: 1,
          expect:
            "<ul><li><checkbox/>A<ul><li><checkbox/>B<ul><li><checkbox/>C</li></ul><li-tail>|</li-tail></li></ul></li></ul>",
        },
        // E2: bulletless paragraph in level-2 li(B) → promote to sibling
        // li at level-1; propagation gives it a task_marker.
        {
          at: 2,
          expect:
            "<ul><li><checkbox/>A<ul><li><checkbox/>B<ul><li><checkbox/>C</li></ul></li><li><checkbox/>|</li></ul></li></ul>",
        },
        // E3: level-1 marker-only → bulletless tail inside top-li(A).
        {
          at: 3,
          expect:
            "<ul><li><checkbox/>A<ul><li><checkbox/>B<ul><li><checkbox/>C</li></ul></li></ul><li-tail>|</li-tail></li></ul>",
        },
        // E4: bulletless paragraph in top-li(A) → promote to top-level
        // sibling; propagation gives it a task_marker.
        {
          at: 4,
          expect:
            "<ul><li><checkbox/>A<ul><li><checkbox/>B<ul><li><checkbox/>C</li></ul></li></ul></li><li><checkbox/>|</li></ul>",
        },
        // E5: top-level marker-only with prev → exit list to plain p.
        {
          at: 5,
          expect:
            "<ul><li><checkbox/>A<ul><li><checkbox/>B<ul><li><checkbox/>C</li></ul></li></ul></li></ul>\n|",
        },
      ],
    },
    {
      id: "nested-staircase-exit",
      label: "Nested empty task: 3-step staircase exit (bulletless → outer task → plain)",
      seed: "- [ ] a\n  - [ ] b\n  - [ ] ",
      events: ["<Enter>", "<Enter>", "<Enter>"],
      checkpoints: [
        {
          at: 0,
          expect:
            "<ul><li><checkbox/>a<ul><li><checkbox/>b</li><li><checkbox/>|</li></ul></li></ul>",
        },
        // Enter 1: delete task_marker + liftNestedEmptyItemToBulletless.
        // Bulletless paragraph appears in outer li after the nested ul.
        {
          at: 1,
          expect:
            "<ul><li><checkbox/>a<ul><li><checkbox/>b</li></ul><li-tail>|</li-tail></li></ul>",
        },
        // Enter 2: list chain → liftBulletlessParagraphToListItem creates
        // an empty outer-level li; propagateMarkerPlugin then inserts
        // a task_marker since the prev sibling is a task.
        {
          at: 2,
          expect:
            "<ul><li><checkbox/>a<ul><li><checkbox/>b</li></ul></li><li><checkbox/>|</li></ul>",
        },
        // Enter 3: outer-level marker-only with prev → exit.
        {
          at: 3,
          expect:
            "<ul><li><checkbox/>a<ul><li><checkbox/>b</li></ul></li></ul>\n|",
        },
      ],
    },
    {
      id: "cursor-trap-arrowleft",
      label: "ArrowLeft can't pass left of the task_marker",
      seed: "- [ ] abc",
      events: [
        "<ArrowLeft>",
        "<ArrowLeft>",
        "<ArrowLeft>",
        "<ArrowLeft>",
        "<ArrowLeft>",
      ],
      checkpoints: [
        { at: 0, expect: "<ul><li><checkbox/>abc|</li></ul>" },
        { at: 1, expect: "<ul><li><checkbox/>ab|c</li></ul>" },
        { at: 2, expect: "<ul><li><checkbox/>a|bc</li></ul>" },
        { at: 3, expect: "<ul><li><checkbox/>|abc</li></ul>" },
        { at: 4, expect: "<ul><li><checkbox/>|abc</li></ul>" },
        { at: 5, expect: "<ul><li><checkbox/>|abc</li></ul>" },
      ],
    },
  ],
};
