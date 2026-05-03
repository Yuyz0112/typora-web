import { describe, expect, test } from "@voidzero-dev/vite-plus-test";
import { EditorState, TextSelection, type Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { leaveLineDraft } from "../src/block-draft.ts";
import { schema } from "../src/schema.ts";

// Mock feature: `!! foo` (any number of leading bangs + space + content)
// promotes to heading(level = bang count) on leave-line. Chosen because it
// avoids colliding with real md syntax while exercising the helper in its
// full shape (variable prefix, data carried to commit, non-trivial node
// replacement).
const bang = leaveLineDraft<{ level: number }>({
  match: (text) => {
    const m = /^(!{1,6}) (.+)$/.exec(text);
    if (!m) return null;
    return { data: { level: m[1]!.length }, prefixLen: m[1]!.length + 1 };
  },
  draftClass: (data) => `bang-draft-${data.level}`,
  commit: (tr, pos, paragraph, data) => {
    const content = paragraph.textContent.slice(data.level + 1);
    const heading = schema.nodes.heading.create(
      { level: data.level },
      content ? schema.text(content) : null,
    );
    tr.replaceWith(pos, pos + paragraph.nodeSize, heading);
  },
});

function mkDoc(paragraphs: string[]) {
  return schema.node(
    "doc",
    null,
    paragraphs.map((t) =>
      schema.node("paragraph", null, t ? [schema.text(t)] : []),
    ),
  );
}

function mkState(paragraphs: string[], cursorInPara: number, extraPlugins: Plugin[] = []) {
  const doc = mkDoc(paragraphs);
  let off = 0;
  for (let i = 0; i < cursorInPara; i++) off += doc.child(i).nodeSize;
  const pos = off + 1 + doc.child(cursorInPara).content.size; // end of that paragraph
  return EditorState.create({
    schema,
    doc,
    plugins: [bang.plugin, ...extraPlugins],
    selection: TextSelection.create(doc, pos),
  });
}

describe("leaveLineDraft", () => {
  test("match on cursor paragraph yields node + prefix decorations", () => {
    const state = mkState(["!! hello", "world"], 0);
    const decos = bang.plugin.getState(state)!.find();
    expect(decos).toHaveLength(2);
    // Decoration.node wraps the whole paragraph [0, nodeSize].
    expect(decos[0]!.from).toBe(0);
    expect(decos[0]!.to).toBe(state.doc.child(0).nodeSize);
    // Decoration.inline covers the `!! ` prefix (3 chars) inside paragraph.
    expect(decos[1]!.from).toBe(1);
    expect(decos[1]!.to).toBe(4);
  });

  test("no match → no decorations", () => {
    const state = mkState(["just text", "!! elsewhere"], 0);
    expect(bang.plugin.getState(state)!.find()).toHaveLength(0);
  });

  test("cursor in non-matching paragraph next to a matching one → no decorations", () => {
    // `!!` paragraph matches, but cursor is in the second one.
    const state = mkState(["!! hello", "world"], 1);
    expect(bang.plugin.getState(state)!.find()).toHaveLength(0);
  });

  test("moving cursor to another paragraph commits the draft", () => {
    const state = mkState(["!! hello", "world"], 0);
    // Move cursor to paragraph 2 start — simulates arrow-down leave.
    const p2start = state.doc.child(0).nodeSize + 1;
    const tr = state.tr.setSelection(TextSelection.create(state.doc, p2start));
    const next = state.apply(tr);
    const first = next.doc.child(0);
    expect(first.type.name).toBe("heading");
    expect(first.attrs.level).toBe(2);
    expect(first.textContent).toBe("hello");
  });

  test("typing inside the matching paragraph does NOT commit", () => {
    const state = mkState(["!! hello", "world"], 0);
    const caret = 1 + "!! hello".length; // end of first paragraph
    const tr = state.tr.insertText("!", caret, caret);
    const next = state.apply(tr);
    // Still a paragraph; cursor still inside; no commit.
    expect(next.doc.child(0).type.name).toBe("paragraph");
    expect(next.doc.child(0).textContent).toBe("!! hello!");
  });

  test("paragraph no longer matches at leave time → no commit", () => {
    // Start matching; a single compound transaction both deletes the `!! `
    // prefix and moves the cursor away. Helper should recheck on newState
    // and bail — otherwise it would promote a paragraph whose current
    // text doesn't match the pattern, producing a heading with wrong data.
    const state = mkState(["!! hello", "world"], 0);
    const tr = state.tr;
    tr.delete(1, 4); // remove `!! ` → first paragraph becomes "hello"
    const p2start = tr.doc.child(0).nodeSize + 1;
    tr.setSelection(TextSelection.create(tr.doc, p2start));
    const next = state.apply(tr);
    expect(next.doc.child(0).type.name).toBe("paragraph");
    expect(next.doc.child(0).textContent).toBe("hello");
  });

  test("imperative handle.commit(view) fires without selection change", () => {
    const state = mkState(["!! hello"], 0);
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      expect(bang.commit(view)).toBe(true);
      expect(view.state.doc.child(0).type.name).toBe("heading");
      expect(view.state.doc.child(0).textContent).toBe("hello");
    } finally {
      view.destroy();
      mount.remove();
    }
  });

  test("handle.commit(view) no-ops when pattern does not match", () => {
    const state = mkState(["plain"], 0);
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const view = new EditorView(mount, { state });
    try {
      expect(bang.commit(view)).toBe(false);
      expect(view.state.doc.child(0).type.name).toBe("paragraph");
    } finally {
      view.destroy();
      mount.remove();
    }
  });
});
