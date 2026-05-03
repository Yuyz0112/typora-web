// Public API for the editor as a library.
//
// Lib consumers compose a ProseMirror EditorView themselves; we hand
// them the schema, the parser/serializer, and the plugin stack that
// realizes the Typora-style WYSIWYG behaviors. PM packages (state,
// view, model, etc.) stay external — consumers bring their own.
//
// Anything under specs/, tests/, or website/ is OFF-LIMITS to this
// entry point. Keeping that boundary clean is what lets the lib
// bundle stay free of test fixtures and harness UI.

export { defaultPlugins, createState } from "./editor.ts";
export { schema } from "./schema.ts";
export { parse } from "./parser.ts";
export { serialize } from "./serializer.ts";

export type { FeatureSpec } from "./features/_types.ts";
