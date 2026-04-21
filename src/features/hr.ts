import type { Schema } from "prosemirror-model";

import { leaveLineDraft } from "../block-draft.ts";
import type { FeatureSpec } from "./_types.ts";

// horizontal_rule (HR).
//
// Commit timing = leave-line. While the cursor is still on the line
// containing exactly `---` (or `***` / `___`), the line stays a regular
// paragraph but the three delim chars render gray (`<g>---</g>`) as a
// draft hint. Only when the selection leaves that line (Enter, Arrow
// up/down, click elsewhere) does the paragraph get replaced with an
// `horizontal_rule` node.
//
// Adding a 4th char (or anything that breaks the `^[-*_]{3}$` match)
// should drop the draft immediately — it's back to plain text.
//
// See `cases` below for the exact contract.

type HRVariant = "-" | "*" | "_";

const HR_RE = /^(-{3,}|\*{3,}|_{3,})$/;

function makeHrPlugin(schema: Schema) {
  return leaveLineDraft<{ variant: HRVariant }>({
    match: (text) => {
      const m = HR_RE.exec(text);
      if (!m) return null;
      return {
        data: { variant: m[1]![0] as HRVariant },
        // All leading chars (= the whole matched run) render gray.
        prefixLen: m[1]!.length,
      };
    },
    draftClass: () => "hr-draft",
    commit: (tr, pos, paragraph) => {
      const hrNode = schema.nodes.horizontal_rule!.create();
      // If the HR would end up as the doc's last node, PM needs a
      // trailing textblock for the caret to live in. Enter typically
      // provides that via the baseKeymap splitBlock (which runs before
      // our appendTransaction), but arrow-leave / click-leave / tests
      // that don't go through Enter may leave the HR as the last node.
      const parent = tr.doc.resolve(pos).parent;
      const idxOfPara = tr.doc.resolve(pos).index();
      const isLast = idxOfPara === parent.childCount - 1;
      if (isLast) {
        const empty = schema.nodes.paragraph!.create();
        tr.replaceWith(pos, pos + paragraph.nodeSize, [hrNode, empty]);
      } else {
        tr.replaceWith(pos, pos + paragraph.nodeSize, hrNode);
      }
    },
  });
}

export const hr: FeatureSpec = {
  name: "horizontal_rule",

  plugins: (schema) => [makeHrPlugin(schema).plugin],

  cases: [
    {
      id: "dashes-commit-on-enter",
      label: "--- + Enter → HR",
      seed: "",
      events: ["-", "-", "-", "<Enter>"],
      checkpoints: [
        { at: 2, expect: "--|" },
        { at: 3, expect: "<g>---</g>|" },
        { at: 4, expect: "---\n|" },
      ],
    },
    {
      id: "asterisks-commit-on-enter",
      label: "*** + Enter → HR (asterisk variant)",
      seed: "",
      events: ["*", "*", "*", "<Enter>"],
      checkpoints: [
        { at: 3, expect: "<g>***</g>|" },
        { at: 4, expect: "---\n|" },
      ],
    },
    {
      id: "underscores-commit-on-enter",
      label: "___ + Enter → HR (underscore variant)",
      seed: "",
      events: ["_", "_", "_", "<Enter>"],
      checkpoints: [
        { at: 3, expect: "<g>___</g>|" },
        { at: 4, expect: "---\n|" },
      ],
    },
    {
      id: "fourth-char-drops-draft",
      label: "---a — a 4th char breaks the match, no more draft",
      seed: "",
      events: ["-", "-", "-", "a"],
      checkpoints: [
        { at: 3, expect: "<g>---</g>|" },
        { at: 4, expect: "---a|" },
      ],
    },
    {
      id: "not-at-line-start",
      label: "a--- — delims not at line start, never a draft",
      seed: "",
      events: ["a", "-", "-", "-", "<Enter>"],
      checkpoints: [
        { at: 4, expect: "a---|" },
        { at: 5, expect: "a---\n|" },
      ],
    },
  ],
};
