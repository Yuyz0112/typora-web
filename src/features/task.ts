import type { Node as PMNode } from "prosemirror-model";
import { liftListItem, splitListItem } from "prosemirror-schema-list";
import { InputRule } from "prosemirror-inputrules";
import { Plugin, TextSelection, type Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import type { FeatureSpec } from "./_types.ts";

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

const nodes = {
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
  const firstChild = li.firstChild;
  if (!firstChild || firstChild.type.name !== "paragraph") return li;
  const firstText = firstChild.firstChild;
  if (!firstText || !firstText.isText) return li;
  const m = TASK_RE.exec(firstText.text!);
  if (!m) return li;

  const checked = m[1] === "[x]";
  const sch = li.type.schema;
  const marker = sch.nodes.task_marker.create({ checked });
  const remainingText = firstText.text!.slice(m[0].length);

  const newInlineChildren: PMNode[] = [marker];
  if (remainingText) {
    newInlineChildren.push(sch.text(remainingText, firstText.marks));
  }
  // Append remaining inline children of the paragraph after the first text.
  firstChild.forEach((child, _, idx) => {
    if (idx > 0) newInlineChildren.push(child);
  });
  const newPara = firstChild.type.createAndFill(
    firstChild.attrs,
    newInlineChildren,
  )!;

  const newLiChildren: PMNode[] = [newPara];
  li.forEach((child, _, idx) => {
    if (idx > 0) newLiChildren.push(child);
  });
  return li.type.createAndFill(li.attrs, newLiChildren)!;
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
      view.dispatch(
        view.state.tr.setNodeMarkup(pos, undefined, {
          checked: !node.attrs.checked,
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

const taskEnter: Command = (state, dispatch) => {
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
  const para = li.firstChild!;
  // Marker-only when the paragraph contains exactly one inline child (the
  // marker) — content size 1.
  const markerOnly = para.content.size === 1;

  if (markerOnly) {
    // Atomic delete-marker + lift list_item out of the list.
    const pStart = $from.before(liDepth) + 2; // li open + p open
    const tr = state.tr.delete(pStart, pStart + 1); // task_marker is 1 pos
    const after = state.apply(tr);
    const lift = liftListItem(state.schema.nodes.list_item);
    let liftPos = -1;
    lift(after, (liftTr) => {
      for (const step of liftTr.steps) tr.step(step);
      liftPos = liftTr.selection.from;
    });
    if (liftPos >= 0) {
      tr.setSelection(TextSelection.create(tr.doc, liftPos));
    }
    if (dispatch) dispatch(tr);
    return true;
  }

  // Has content beyond the marker: split + seed the new sibling with the
  // same marker shape.
  const splitCmd = splitListItem(state.schema.nodes.list_item);
  const checked = para.firstChild!.attrs.checked === true;
  let combined: import("prosemirror-state").Transaction | null = null;
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
};

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
  plugins: () => [nodeViewPlugin(), cursorTrapPlugin()],

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
      id: "marker-only-enter-exits",
      label: "Enter on a marker-only task item exits the task list",
      seed: "- [ ] a",
      events: ["<Enter>", "<Enter>"],
      checkpoints: [
        { at: 0, expect: "<ul><li><checkbox/>a|</li></ul>" },
        { at: 1, expect: "<ul><li><checkbox/>a</li><li><checkbox/>|</li></ul>" },
        { at: 2, expect: "<ul><li><checkbox/>a</li></ul>\n|" },
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
