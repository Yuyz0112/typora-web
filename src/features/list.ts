import { wrappingInputRule } from "prosemirror-inputrules";
import { chainCommands } from "prosemirror-commands";
import {
  liftListItem,
  sinkListItem,
  splitListItem,
} from "prosemirror-schema-list";
import { TextSelection, type Command } from "prosemirror-state";
import type { NodeType } from "prosemirror-model";

import type { FeatureSpec } from "./_types.ts";

// ── Custom commands for Typora-style 3-step staircase exit ────────────────
//
// PM's default chain(splitListItem, liftListItem) on an empty nested li
// jumps straight from "empty nested li" → "empty outer-sibling li". Typora
// inserts an extra intermediate state: the empty nested li first becomes
// a bulletless paragraph appended to the outer li's content (after the
// nested ul). Only a second Enter promotes that paragraph to a real
// outer-sibling list_item.

// Fire when the cursor sits in an empty paragraph inside an empty NESTED
// list_item (grandparent-of-li is itself a list_item). Delete the nested
// li and append a bulletless paragraph to the outer li.
function liftNestedEmptyItemToBulletless(
  li: NodeType,
  paragraph: NodeType,
): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty) return false;
    const p = $from.parent;
    if (p.type !== paragraph || p.content.size !== 0) return false;
    // depth of the paragraph is $from.depth; li is depth-1.
    const liDepth = $from.depth - 1;
    if (liDepth < 1) return false;
    const liNode = $from.node(liDepth);
    if (liNode.type !== li) return false;
    // li must contain exactly one child (the empty paragraph) — otherwise
    // this is a bulletless-tail case handled by the next command.
    if (liNode.childCount !== 1) return false;
    const listDepth = liDepth - 1;
    if (listDepth < 1) return false;
    const listNode = $from.node(listDepth);
    if (
      listNode.type.name !== "bullet_list" &&
      listNode.type.name !== "ordered_list"
    ) {
      return false;
    }
    const outerLiDepth = listDepth - 1;
    if (outerLiDepth < 1) return false;
    const outerLi = $from.node(outerLiDepth);
    if (outerLi.type !== li) return false;

    const liStart = $from.before(liDepth);
    const liEnd = $from.after(liDepth);
    const outerLiEnd = $from.after(outerLiDepth);

    if (dispatch) {
      const tr = state.tr;
      // If the nested li is the only child of the list, delete the whole
      // list (schema disallows empty list). Otherwise just delete this li.
      if (listNode.childCount === 1) {
        tr.delete($from.before(listDepth), $from.after(listDepth));
      } else {
        tr.delete(liStart, liEnd);
      }
      // Insert an empty paragraph just before outerLi's close token.
      const insertPos = tr.mapping.map(outerLiEnd) - 1;
      const newPara = paragraph.createAndFill();
      if (!newPara) return false;
      tr.insert(insertPos, newPara);
      tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
      tr.scrollIntoView();
      dispatch(tr);
    }
    return true;
  };
}

// Fire when the cursor sits in an empty bulletless paragraph inside a
// list_item (i.e. the paragraph is NOT the li's first child). Promote
// that paragraph into a new list_item that becomes the outer li's next
// sibling.
function liftBulletlessParagraphToListItem(li: NodeType): Command {
  return (state, dispatch) => {
    const { $from, empty } = state.selection;
    if (!empty) return false;
    const p = $from.parent;
    if (p.type.name !== "paragraph" || p.content.size !== 0) return false;
    const pDepth = $from.depth;
    const liDepth = pDepth - 1;
    if (liDepth < 1) return false;
    const liNode = $from.node(liDepth);
    if (liNode.type !== li) return false;
    // Determine this paragraph's index among li children — must NOT be 0.
    const pIndex = $from.index(liDepth);
    if (pIndex === 0) return false;
    const listDepth = liDepth - 1;
    if (listDepth < 1) return false;
    const listNode = $from.node(listDepth);
    if (
      listNode.type.name !== "bullet_list" &&
      listNode.type.name !== "ordered_list"
    ) {
      return false;
    }

    const pStart = $from.before(pDepth);
    const pEnd = $from.after(pDepth);
    const outerLiEnd = $from.after(liDepth);

    if (dispatch) {
      const tr = state.tr;
      // Delete the paragraph from outer li.
      tr.delete(pStart, pEnd);
      // Build a new list_item containing an empty paragraph.
      const newLi = li.createAndFill();
      if (!newLi) return false;
      // Insert just after outer li's close token (outerLiEnd mapped).
      const insertPos = tr.mapping.map(outerLiEnd);
      tr.insert(insertPos, newLi);
      // Cursor inside the new li's paragraph: insertPos + 2 (open li, open p).
      tr.setSelection(TextSelection.create(tr.doc, insertPos + 2));
      tr.scrollIntoView();
      dispatch(tr);
    }
    return true;
  };
}

// Bullet list feature (method-B-adjacent; list_item is a block node).
//
// Core schema/parser/serializer already understand `bullet_list` / `ordered_list`
// / `list_item`. What this feature must add (IMPLEMENTATION WORK — not in this
// stub):
//
//   - Input rule `^- $` (space triggers wrap). Typora behaviour: a bare `-`
//     stays in a paragraph, but the moment the user types the trailing space
//     the paragraph wraps into a one-item bullet_list. No further character
//     is required — unlike emphasis, which needs the closing delim pair.
//     `-a` (no space) must stay a paragraph.
//
//   - Enter keymap override:
//       * non-empty list_item + Enter  → splitListItem  (new empty sibling li)
//       * empty list_item + Enter      → liftListItem   ("staircase" exit)
//         ↳ at top level: exits the list entirely, becoming a paragraph
//         ↳ nested: lifts ONE level. The intermediate state is the lifted
//           item sitting inside the outer <li> as a bare paragraph (indented
//           but without its own bullet). A subsequent Enter lifts again,
//           surfacing it as a sibling of the outer item (new bullet appears).
//
//   - Tab / Shift-Tab keymap: prosemirror-schema-list's sinkListItem /
//     liftListItem. sinkListItem requires a previous sibling (can't sink
//     the first item in a list). <Mod-]> / <Mod-[> should bind the same
//     commands for keyboard parity (nice-to-have; flag below).
//
// OPEN QUESTIONS — flagged for the implementer / reviewer:
//
//   Q1. Ordered list (`1. foo`) is intentionally NOT covered in this stub.
//       Mirror the bullet cases once the bullet path is green.
//
//   Q2. pretty() rendering of the "intermediate staircase state" (a bare
//       <p> sitting inside a <li> alongside a nested <ul>) is NOT
//       exercised by any existing test. test-pretty.ts's `li` branch just
//       returns children, and the parent ul prefixes only the FIRST line
//       with `- ` (subsequent lines get 2-space indent). So a <li> whose
//       children are `<p>a</p><ul><li><p>b</p></li></ul><p></p>` would
//       render roughly as:
//           "- a\n  - b\n  "
//       i.e. the trailing empty paragraph shows up as a blank indented
//       line with no bullet. I'm NOT 100% confident in this guess — the
//       cursor span / trailing-break filter may alter it. Expects marked
//       "PROBABLY WRONG — verify after implementation" below.
//
//   Q3. Multi-line seed: `seed` is parsed via `parse(md)`, so a seed like
//       "- a\n  - b" should round-trip to an outer bullet_list with one
//       item containing "a" plus a nested bullet_list with one item "b".
//       If the parser trims trailing spaces or the serializer re-renders
//       with different indent width, the seed-state pretty may differ.
//
//   Q4. Where does cursor land after seed parse? `setup(md)` typically
//       places cursor at end-of-doc. For seed `"- a\n  - b"` that should
//       be at the end of `b` inside the inner li. A `<End>` in the case
//       is defensive.
//
//   Q5. <Shift-Tab> event DSL: parseSpecial splits on `-`, last segment is
//       the key, preceding are mods — so `<Shift-Tab>` → key=Tab, mods={Shift}.
//       This should work as long as the feature's keymap binds "Shift-Tab".
//
//   Q6. sinkListItem on an empty first-and-only item: no-op (nothing to sink
//       under). Not tested here.
//
//   Q7. When Tab sinks a second item under the first, test-pretty indent is
//       2 spaces (hard-coded `" ".repeat(prefix.length)` with prefix `"- "`).
//       This matches Typora's canonical 2-space nested bullet.
//
// NB: every `expect` string below is a best-effort guess. Markers:
//   [CONFIDENT]   — high confidence, directly analogous to existing tests
//   [VERIFY]      — reasonable guess, likely right within ±caret-position
//   [PROBABLY WRONG] — structural guess; almost certainly needs tweaking
//                      after the real implementation lands

export const list: FeatureSpec = {
  name: "bullet_list",

  inputRules: (schema) => [
    // `- ` at paragraph start wraps the paragraph into bullet_list.
    wrappingInputRule(/^-\s$/, schema.nodes.bullet_list),
  ],

  keymap: (schema) => {
    const li = schema.nodes.list_item;
    const p = schema.nodes.paragraph;
    return {
      // 3-step staircase (Typora-style) for nested empty li:
      //   1. splitListItem — non-empty li → new empty sibling
      //   2. liftNestedEmptyItemToBulletless — empty nested li → bulletless
      //      paragraph appended to outer li's content
      //   3. liftBulletlessParagraphToListItem — bulletless p → real
      //      outer-sibling list_item
      //   4. liftListItem — empty outer li → exit list (PM default)
      // NB: liftNestedEmptyItemToBulletless must run BEFORE splitListItem.
      // PM's splitListItem "helpfully" handles empty-nested-last-item by
      // creating an outer-sibling li (the 2-step staircase). We want the
      // 3-step staircase, so we intercept the empty-nested case first and
      // only fall through to splitListItem for non-empty items (where our
      // custom command returns false).
      Enter: chainCommands(
        liftNestedEmptyItemToBulletless(li, p),
        liftBulletlessParagraphToListItem(li),
        splitListItem(li),
        liftListItem(li),
      ),
      Tab: sinkListItem(li),
    };
  },

  cases: [
    // ── 1. immediate wrap on space ──────────────────────────────────────
    {
      id: "dash-space-wraps",
      label: "`- ` (dash + space) wraps current paragraph into a bullet list",
      seed: "",
      events: ["-", " "],
      checkpoints: [
        // [CONFIDENT] bare `-` before the trigger space is still a paragraph.
        { at: 1, expect: "-|" },
        // [VERIFY] after space: empty list_item, cursor at item start.
        //   pretty: ul → "- " prefix + li children (empty) + caret.
        { at: 2, expect: "- |" },
      ],
    },

    // ── 2. non-space does NOT trigger ───────────────────────────────────
    {
      id: "dash-char-no-wrap",
      label: "`-a` (dash + letter, no space) stays in a paragraph",
      seed: "",
      events: ["-", "a"],
      checkpoints: [
        // [CONFIDENT] input rule never fires → still a paragraph.
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
        { at: 2, expect: "- |" },
        // [CONFIDENT]
        { at: 3, expect: "- a|" },
      ],
    },

    // ── 4. Enter creates a new sibling item ─────────────────────────────
    {
      id: "enter-splits-item",
      label: "Enter in a non-empty item splits into a new empty sibling",
      seed: "",
      events: ["-", " ", "a", "<Enter>", "b"],
      checkpoints: [
        { at: 3, expect: "- a|" },
        // [VERIFY] new empty second item, cursor at its start.
        //   ul renders each child li on its own line with `- ` prefix.
        { at: 4, expect: "- a\n- |" },
        // [VERIFY]
        { at: 5, expect: "- a\n- b|" },
      ],
    },

    // ── 5. top-level empty item + Enter → exit list to paragraph ────────
    {
      id: "enter-on-empty-exits",
      label: "Enter on an empty top-level item exits the list (liftListItem)",
      seed: "",
      events: ["-", " ", "a", "<Enter>", "<Enter>"],
      checkpoints: [
        { at: 4, expect: "- a\n- |" },
        // [VERIFY] the empty item is lifted out, becoming a sibling paragraph
        //   after the (now one-item) list. pretty joins block children with
        //   "\n" — so: list line, then an empty paragraph with the caret.
        { at: 5, expect: "- a\n|" },
      ],
    },

    // ── 6. Nest via Tab ─────────────────────────────────────────────────
    {
      id: "tab-sinks-item",
      label: "Tab on a second item sinks it into a nested list under the first",
      seed: "- a",
      events: ["<Enter>", "<Tab>", "b"],
      checkpoints: [
        // [VERIFY] assumes seed places cursor at end of "a"; Enter gives
        //   an empty sibling item.
        { at: 1, expect: "- a\n- |" },
        // [VERIFY] sinkListItem wraps the empty item into a nested ul under
        //   the first item. pretty indent is 2 spaces (prefix "- ".length).
        { at: 2, expect: "- a\n  - |" },
        // [VERIFY]
        { at: 3, expect: "- a\n  - b|" },
      ],
    },

    // ── 7. Nested staircase exit ────────────────────────────────────────
    //
    // seed:     - a
    //             - b|    (cursor at end of `b`)
    //
    // Sequence (Typora-verified in the task spec):
    //   Enter 1 → empty sibling at the inner level       `- a\n  - b\n  - |`
    //   Enter 2 → LIFT once: intermediate state,
    //             bare paragraph inside outer <li>
    //             (indented, no bullet)                  ???  [PROBABLY WRONG]
    //   Enter 3 → LIFT again: surfaces as sibling of `a` `- a\n  - b\n- |`
    {
      id: "staircase-exit",
      label: "Nested empty item + repeated Enter: 3-step Typora staircase",
      seed: "- a\n  - b",
      events: ["<End>", "<Enter>", "<Enter>", "<Enter>", "<Enter>"],
      checkpoints: [
        { at: 1, expect: "- a\n  - b|" },
        // Enter 1: splitListItem — new empty nested sibling.
        { at: 2, expect: "- a\n  - b\n  - |" },
        // Enter 2: bulletless intermediate — empty nested li becomes a
        // bare paragraph appended to the outer li (after the nested ul).
        { at: 3, expect: "- a\n  - b\n  <li-tail>|</li-tail>" },
        // Enter 3: bulletless p is promoted to outer-sibling list_item.
        { at: 4, expect: "- a\n  - b\n- |" },
        // Enter 4: liftListItem exits the list entirely.
        { at: 5, expect: "- a\n  - b\n|" },
      ],
    },

  ],
};
