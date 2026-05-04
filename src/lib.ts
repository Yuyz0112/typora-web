// Public API for the editor as a library.
//
// Consumers see only `createEditor` and the small `Editor` controller
// it returns. ProseMirror is an implementation detail and is not on
// this surface (the controller's `view` getter is an opt-in escape
// hatch for advanced cases).

export { createEditor } from "./editor-api.ts";
export type { Editor, EditorOptions } from "./editor-api.ts";
