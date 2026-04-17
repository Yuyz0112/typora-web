import type { Node as PMNode } from "prosemirror-model";
import { EditorState, type Plugin } from "prosemirror-state";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";

import { cursorRenderPlugin } from "./cursor-render.ts";
import { syntaxHintsPlugin } from "./decorations.ts";
import { markdownInputRules, spaceBreaksStoredMarks } from "./input-rules.ts";
import { schema } from "./schema.ts";

export function defaultPlugins(): Plugin[] {
  return [
    history(),
    keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
    markdownInputRules(),
    spaceBreaksStoredMarks(),
    syntaxHintsPlugin(),
    cursorRenderPlugin(),
    keymap(baseKeymap),
  ];
}

export function createState(doc: PMNode): EditorState {
  return EditorState.create({ schema, doc, plugins: defaultPlugins() });
}
