import type { Node as PMNode } from "prosemirror-model";
import { EditorState, Plugin, Selection, TextSelection } from "prosemirror-state";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";

import { cursorRenderPlugin } from "./cursor-render.ts";
import { syntaxHintsPlugin } from "./decorations.ts";
import { collectKeymaps, collectPlugins } from "./features/index.ts";
import { markdownInputRules, spaceBreaksStoredMarks } from "./input-rules.ts";
import { normalizeInlinePlugin } from "./normalize.ts";
import { schema } from "./schema.ts";

// Typora UX: ArrowDown at the very end of the doc creates a fresh empty
// paragraph and lands the caret there — doubles as the "leave the line"
// trigger for leaveLineDraft features (heading / hr / fenced-code) when
// the draft paragraph is the last block in the doc.
function lastLineArrowDownPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, e) {
        if (e.key !== "ArrowDown") return false;
        if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
        const { state } = view;
        const sel = state.selection;
        if (!sel.empty) return false;
        // Only fire when the cursor is at the doc's absolute end position.
        // Selection.atEnd covers blockquote / list / heading contexts too.
        const end = Selection.atEnd(state.doc);
        if (sel.from !== end.from) return false;
        const paraType = state.schema.nodes.paragraph;
        if (!paraType) return false;
        const newPara = paraType.createAndFill();
        if (!newPara) return false;
        const insertPos = state.doc.content.size;
        const tr = state.tr.insert(insertPos, newPara);
        tr.setSelection(TextSelection.create(tr.doc, insertPos + 1));
        view.dispatch(tr);
        return true;
      },
    },
  });
}

export function defaultPlugins(options: { cursorWidget?: boolean } = {}): Plugin[] {
  // cursorRenderPlugin paints a visible caret even when the view is not
  // focused — only useful for the replay harness (fakeView has no focus).
  // A real browser editor already draws its own caret, so a live editor
  // should pass `{ cursorWidget: false }`.
  const { cursorWidget = true } = options;
  const featureKeymap = collectKeymaps(schema);
  const plugins: Plugin[] = [
    history(),
    keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
    markdownInputRules(),
    spaceBreaksStoredMarks(),
    normalizeInlinePlugin(),
    // Feature-contributed plugins sit after normalize (so block-draft
    // watchers see the post-normalize doc) and before syntaxHints (so any
    // extra decorations merge into PM's decoration pipeline naturally).
    ...collectPlugins(schema),
    syntaxHintsPlugin(),
  ];
  if (cursorWidget) plugins.push(cursorRenderPlugin());
  // Feature keymap wins over baseKeymap — features that override Enter /
  // Backspace for block exits rely on this ordering.
  if (Object.keys(featureKeymap).length > 0) plugins.push(keymap(featureKeymap));
  // last-line ArrowDown must run BEFORE baseKeymap (which would otherwise
  // swallow ArrowDown for NodeSelection / move-down) but AFTER feature
  // keymaps so specific handlers still get first dibs.
  plugins.push(lastLineArrowDownPlugin());
  plugins.push(keymap(baseKeymap));
  return plugins;
}

export function createState(doc: PMNode): EditorState {
  return EditorState.create({ schema, doc, plugins: defaultPlugins() });
}
