import type { Node as PMNode } from "prosemirror-model";
import type { NodeSpec } from "prosemirror-model";
import { liftListItem, splitListItem } from "prosemirror-schema-list";
import { InputRule } from "prosemirror-inputrules";
import { Plugin, TextSelection, type Command, type Transaction } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import type { FeatureSpec } from "./_types.ts";
import { liftNestedEmptyItemToBulletless } from "./list.ts";

// Task list — implemented as an atom inline node `task_marker` that lives
// at the start of a list_item's first paragraph. The node renders as a
// checkbox via NodeView; PM treats it as a single position so the cursor
// can never land "inside" the marker (no fragile font-size:0 hidden-text
// tricks, no native-caret-collapse bug). Source `[ ] ` / `[x] ` round-trips
// via parserPostProcess (text → node) and inlineNodeHandlers (node → text).

const TASK_RE = /^(\[ \]|\[x\]) /;

// ──────────────────────────────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────────────────────────────

const nodes: Record<string, NodeSpec> = {
  task_marker: {
    group: "inline",
    inline: true,
    atom: true,
    selectable: false,
    attrs: { checked: { default: false } },
    parseDOM: [
      {
        tag: "span.task-marker",
        getAttrs: (el: HTMLElement) => ({
          checked: el.getAttribute("data-checked") === "1",
        }),
      },
    ],
    toDOM: (node: PMNode) => [
      "span",
      {
        class: "task-marker",
        "data-checked": node.attrs.checked ? "1" : "0",
      },
    ],
  },
};

// ──────────────────────────────────────────────────────────────────────
// Parser post-process: walk list_items, fold `[ ] ` / `[x] ` text prefix
// in the first paragraph into a task_marker node.
// ──────────────────────────────────────────────────────────────────────

function transformListItem(li: PMNode): PMNode {
  // Two independent transformations on this list item:
  //   (a) if the first paragraph starts with `[ ] ` / `[x] `, fold the
  //       prefix into a task_marker
  //   (b) recurse into tail children — nested ul/ol need (a) too,
  //       even when *this* li's own first paragraph isn't a task
  // Bug history: (b) used to only run inside the (a) branch, so a
  // non-task li wrapping a task sublist left the inner items as raw
  // `[x]` text. The serializer then escaped the brackets, producing
  // `\[x\]` on round-trip.
  const firstChild = li.firstChild;
  let foldedFirst: PMNode | null = null;
  if (firstChild && firstChild.type.name === "paragraph") {
    const firstText = firstChild.firstChild;
    if (firstText && firstText.isText) {
      const m = TASK_RE.exec(firstText.text!);
      if (m) {
        const checked = m[1] === "[x]";
        const sch = li.type.schema;
        const marker = sch.nodes.task_marker.create({ checked });
        const remainingText = firstText.text!.slice(m[0].length);
        const newInline: PMNode[] = [marker];
        if (remainingText) newInline.push(sch.text(remainingText, firstText.marks));
        firstChild.forEach((child, _, idx) => {
          if (idx > 0) newInline.push(child);
        });
        foldedFirst = firstChild.type.createAndFill(firstChild.attrs, newInline)!;
      }
    }
  }

  const newChildren: PMNode[] = [];
  let changed = foldedFirst !== null;
  li.forEach((child, _, idx) => {
    let next: PMNode;
    if (idx === 0 && foldedFirst) next = foldedFirst;
    else {
      next = transformBlock(child);
      if (next !== child) changed = true;
    }
    newChildren.push(next);
  });
  if (!changed) return li;
  return li.type.createAndFill(li.attrs, newChildren)!;
}

function transformBlock(node: PMNode): PMNode {
  if (node.type.name === "list_item") return transformListItem(node);
  if (!node.isBlock || node.childCount === 0) return node;
  const newChildren: PMNode[] = [];
  let changed = false;
  node.forEach((child) => {
    const t = transformBlock(child);
    if (t !== child) changed = true;
    newChildren.push(t);
  });
  if (!changed) return node;
  return node.type.createAndFill(node.attrs, newChildren)!;
}

const parserPostProcess: NonNullable<FeatureSpec["parserPostProcess"]> = (
  doc,
) => transformBlock(doc);

// ──────────────────────────────────────────────────────────────────────
// Serializer: task_marker → `[ ] ` / `[x] `
// ──────────────────────────────────────────────────────────────────────

const inlineNodeHandlers: NonNullable<FeatureSpec["inlineNodeHandlers"]> = {
  task_marker: (state, node) => {
    state.write(node.attrs.checked ? "[x] " : "[ ] ");
  },
};

// ──────────────────────────────────────────────────────────────────────
// NodeView: render checkbox + click toggle
// ──────────────────────────────────────────────────────────────────────

function buildNodeView() {
  return (node: PMNode, view: EditorView, getPos: () => number | undefined) => {
    // Wrap the visible checkbox in a frame element with transparent
    // padding-right — the native caret renders right against the
    // frame's outer edge, so the padding becomes the visible gap
    // between checkbox and caret.
    const dom = document.createElement("span");
    dom.className = "checkbox-frame";
    dom.setAttribute("contenteditable", "false");
    const cb = document.createElement("span");
    cb.className = "checkbox";
    cb.setAttribute("data-checked", node.attrs.checked ? "1" : "0");
    dom.appendChild(cb);

    const onMousedown = (e: MouseEvent): void => {
      e.preventDefault();
    };
    const onClick = (e: MouseEvent): void => {
      if (!cb.contains(e.target as Node) && e.target !== cb) return;
      e.preventDefault();
      e.stopPropagation();
      const pos = getPos();
      if (pos == null) return;
      // Read the live state's node, NOT the closure's `node` — closure is
      // captured when the NodeView is built and its attrs go stale on
      // every toggle (so checked → checked → checked instead of toggling).
      const cur = view.state.doc.nodeAt(pos);
      if (!cur) return;
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, {
          checked: !cur.attrs.checked,
        }),
      );
    };
    dom.addEventListener("mousedown", onMousedown);
    dom.addEventListener("click", onClick);

    return {
      dom,
      update(updated: PMNode): boolean {
        if (updated.type !== node.type) return false;
        cb.setAttribute(
          "data-checked",
          updated.attrs.checked ? "1" : "0",
        );
        return true;
      },
      destroy(): void {
        dom.removeEventListener("mousedown", onMousedown);
        dom.removeEventListener("click", onClick);
      },
    };
  };
}

function nodeViewPlugin(): Plugin {
  return new Plugin({
    props: {
      nodeViews: {
        task_marker: buildNodeView(),
      },
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Input rule: typing space at end of `[ ]` / `[x]` at the start of a
// list_item paragraph swaps the source text for a task_marker node.
// ──────────────────────────────────────────────────────────────────────

const taskInputRule = new InputRule(
  /^(\[ \]|\[x\]) $/,
  (state, match, start, end) => {
    const $start = state.doc.resolve(start);
    if ($start.parent.type.name !== "paragraph") return null;
    if ($start.depth < 2) return null;
    const grandparent = $start.node($start.depth - 1);
    if (grandparent.type.name !== "list_item") return null;
    // Only trigger at the very start of the paragraph — `start` should be
    // the position right after the paragraph's open token.
    if ($start.parentOffset !== 0) return null;
    const checked = match[1] === "[x]";
    return state.tr.replaceWith(
      start,
      end,
      state.schema.nodes.task_marker.create({ checked }),
    );
  },
);

// ──────────────────────────────────────────────────────────────────────
// Cursor trap: prevent the caret from landing BEFORE the task_marker,
// so the user can't navigate to its visual left side.
// ──────────────────────────────────────────────────────────────────────

function cursorTrapPlugin(): Plugin {
  return new Plugin({
    appendTransaction(_, _oldState, newState) {
      const sel = newState.selection;
      if (!sel.empty) return null;
      const $pos = newState.doc.resolve(sel.from);
      if ($pos.parent.type.name !== "paragraph") return null;
      if ($pos.parentOffset !== 0) return null;
      const firstChild = $pos.parent.firstChild;
      if (!firstChild || firstChild.type.name !== "task_marker") return null;
      // Offset 0 → just before the marker. Snap forward by 1 (atom node
      // is a single position).
      return newState.tr.setSelection(
        TextSelection.create(newState.doc, sel.from + 1),
      );
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Enter handling
// ──────────────────────────────────────────────────────────────────────

function isTaskListItem(li: PMNode): boolean {
  const first = li.firstChild;
  if (!first || first.type.name !== "paragraph") return false;
  const inner = first.firstChild;
  return !!inner && inner.type.name === "task_marker";
}

function doSplitPropagate(
  state: import("prosemirror-state").EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  checked: boolean,
): boolean {
  const splitCmd = splitListItem(state.schema.nodes.list_item);
  let combined: Transaction | null = null;
  splitCmd(state, (splitTr) => {
    const tr = state.tr;
    for (const step of splitTr.steps) tr.step(step);
    const newCursor = splitTr.selection.from;
    tr.replaceWith(
      newCursor,
      newCursor,
      state.schema.nodes.task_marker.create({ checked }),
    );
    tr.setSelection(TextSelection.create(tr.doc, newCursor + 1));
    combined = tr;
  });
  if (!combined) return false;
  if (dispatch) dispatch(combined);
  return true;
}

// Delete the task_marker (1 atom pos) at the start of the cursor's
// paragraph, then run a follow-up command on the post-delete state.
// Implemented as two dispatches because some PM lift commands (notably
// `liftListItem`) build ReplaceAroundStep steps whose Gap range can't
// be safely re-applied to a transaction that already has an unrelated
// step in front — copying the steps verbatim trips PM's "Gap is not a
// flat range" check. Two dispatches sidestep that without re-implementing
// the lift logic. The pair lands in the same input tick so the user sees
// a single visual update; undo will require two presses (acceptable).
function doDeleteAndFollow(
  state: import("prosemirror-state").EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  view: EditorView | undefined,
  pStart: number,
  follow: Command,
): boolean {
  const trDelete = state.tr.delete(pStart, pStart + 1);
  // Dry-run check for keymap chaining — if no dispatch, just probe.
  if (!dispatch) {
    const after = state.apply(trDelete);
    return follow(after, undefined);
  }
  if (!view) {
    // Without a view we can't read the post-dispatch state. Best-effort:
    // dispatch only the delete. The follow-up will fire on the next user
    // Enter.
    dispatch(trDelete);
    return true;
  }
  // Both transactions get a meta flag so the marker-propagation appendTx
  // (below) doesn't refill the just-deleted marker — without this, deleting
  // the marker as part of an exit immediately gets undone.
  trDelete.setMeta(NO_PROPAGATE_META, true);
  dispatch(trDelete);
  const next = view.state;
  follow(next, (followTr) => {
    followTr.setMeta(NO_PROPAGATE_META, true);
    view.dispatch(followTr);
  });
  return true;
}

const NO_PROPAGATE_META = "task-no-propagate";

// Enter handling — operates only on cursor sitting at the start of a task
// list_item's first (task) paragraph. Otherwise returns false and the
// list feature's chain runs.
//
// Cases:
//   - has content beyond the marker (paragraph size > 1) → split + seed
//     the new sibling with a marker (consecutive tasks stay tasks).
//   - marker-only top-level + has prev sibling → exit: delete marker +
//     liftListItem (matches "second consecutive Enter exits" of plain
//     lists, but with the marker in the way).
//   - marker-only top-level + no prev → propagate (lone empty task →
//     create a second empty task; the user wants to keep adding).
//   - marker-only nested → delete marker + liftNestedEmptyItemToBulletless
//     (Step 1 of the staircase exit; subsequent steps are handled by
//     list.ts's chain + propagation appendTransaction below).
const taskEnter: Command = (state, dispatch, view) => {
  const sel = state.selection;
  if (!sel.empty) return false;
  const $from = sel.$from;
  let liDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "list_item") {
      liDepth = d;
      break;
    }
  }
  if (liDepth < 0) return false;
  const li = $from.node(liDepth);
  if (!isTaskListItem(li)) return false;
  // Cursor must be in the FIRST child paragraph (the one with the marker).
  // If the cursor is in a tail block (li-tail / nested ul), let list handle.
  if ($from.index(liDepth) !== 0) return false;
  const para = li.firstChild!;
  const checked = para.firstChild!.attrs.checked === true;
  const markerOnly = para.content.size === 1;

  if (!markerOnly) {
    return doSplitPropagate(state, dispatch, checked);
  }

  // Marker-only.
  const isTopLevel = liDepth === 2; // doc/ul/li
  const pStart = $from.before(liDepth) + 2; // li open + p open

  if (isTopLevel) {
    const liIdx = $from.index(liDepth - 1);
    const hasPrev = liIdx > 0;
    if (hasPrev) {
      // Exit: delete marker + liftListItem.
      return doDeleteAndFollow(
        state,
        dispatch,
        view,
        pStart,
        liftListItem(state.schema.nodes.list_item),
      );
    }
    // No prev sibling → propagate (single-empty-task convenience).
    return doSplitPropagate(state, dispatch, checked);
  }

  // Nested marker-only → step 1 of staircase: bulletless intermediate.
  return doDeleteAndFollow(
    state,
    dispatch,
    view,
    pStart,
    liftNestedEmptyItemToBulletless(
      state.schema.nodes.list_item,
      state.schema.nodes.paragraph,
    ),
  );
};

// Propagate task_marker into any newly-emptied li that follows a task
// li at the same level — covers the "Enter from bulletless paragraph
// promotes to outer-level li, which should inherit the task shape"
// step of the staircase, plus plain insertions next to a task in
// general (consecutive tasks stay tasks even when the user mixes in
// list-only operations).
function propagateMarkerPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((t) => t.docChanged)) return null;
      // taskEnter's delete + lift dispatches set this flag so we don't
      // immediately re-insert the marker we just deleted.
      if (transactions.some((t) => t.getMeta(NO_PROPAGATE_META))) return null;
      const tr = newState.tr;
      let changed = false;
      newState.doc.descendants((node, pos) => {
        if (
          node.type.name !== "bullet_list" &&
          node.type.name !== "ordered_list"
        ) {
          return true;
        }
        let off = pos + 1;
        let prevIsTask = false;
        for (let i = 0; i < node.childCount; i++) {
          const li = node.child(i);
          const liEnd = off + li.nodeSize;
          const firstChild = li.firstChild;
          const isEmpty =
            li.childCount === 1 &&
            firstChild?.type.name === "paragraph" &&
            firstChild.content.size === 0;
          const isTask = isTaskListItem(li);
          if (prevIsTask && isEmpty && !isTask) {
            const insertPos = off + 2; // li open + p open
            const mapped = tr.mapping.map(insertPos);
            tr.replaceWith(
              mapped,
              mapped,
              newState.schema.nodes.task_marker.create({ checked: false }),
            );
            changed = true;
          }
          prevIsTask = isTask;
          off = liEnd;
        }
        // Continue descending so nested ul/ol inside list_items also get
        // their own task_marker propagation pass.
        return true;
      });
      return changed ? tr : null;
    },
  });
}

// ──────────────────────────────────────────────────────────────────────
// Feature export
// ──────────────────────────────────────────────────────────────────────

export const task: FeatureSpec = {
  name: "task",

  nodes,

  parserPostProcess,
  inlineNodeHandlers,

  inputRules: () => [taskInputRule],
  keymap: () => ({ Enter: taskEnter }),
  plugins: () => [nodeViewPlugin(), cursorTrapPlugin(), propagateMarkerPlugin()],

};
