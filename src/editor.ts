import type { Node as PMNode } from "prosemirror-model";
import { EditorState, Plugin } from "prosemirror-state";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";

import { cursorRenderPlugin } from "./cursor-render.ts";
import { syntaxHintsPlugin } from "./decorations.ts";
import { collectKeymaps, collectPlugins } from "./features/index.ts";
import { markdownInputRules, spaceBreaksStoredMarks } from "./input-rules.ts";
import { normalizeInlinePlugin } from "./normalize.ts";
import { schema } from "./schema.ts";

// Open `<a>` links on Cmd/Ctrl+click. Inside contenteditable, a plain
// click moves the caret instead of navigating — opting in to the
// modifier preserves selection-by-click while letting users follow
// links. Auto-collected by collectPlugins indirectly via this module
// so the lib's defaultPlugins() ships it.
function openLinkOnModClickPlugin(): Plugin {
  return new Plugin({
    props: {
      handleClick(_view, _pos, event) {
        const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
        const mod = isMac ? event.metaKey : event.ctrlKey;
        if (!mod) return false;
        const a = (event.target as Element | null)?.closest("a");
        if (!a) return false;
        const href = a.getAttribute("href");
        if (!href) return false;
        event.preventDefault();
        window.open(href, "_blank", "noopener,noreferrer");
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
    openLinkOnModClickPlugin(),
  ];
  if (cursorWidget) plugins.push(cursorRenderPlugin());
  // Feature keymap wins over baseKeymap — features that override Enter /
  // Backspace for block exits rely on this ordering.
  if (Object.keys(featureKeymap).length > 0) plugins.push(keymap(featureKeymap));
  plugins.push(keymap(baseKeymap));
  return plugins;
}

export function createState(doc: PMNode): EditorState {
  return EditorState.create({ schema, doc, plugins: defaultPlugins() });
}
