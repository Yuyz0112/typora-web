// Single registry of all Typora-syntax features. Each core module reads
// exactly from here — adding a feature means one import + one array entry.

import { chainCommands } from "prosemirror-commands";
import type { Command, Plugin } from "prosemirror-state";
import type { Schema } from "prosemirror-model";

import type { Case, FeatureSpec, InlineFeatureSpec } from "./_types.ts";
import { autoPair } from "./auto-pair.ts";
import { autolink } from "./autolink.ts";
import { blockquote } from "./blockquote.ts";
import { code } from "./code.ts";
import { emoji } from "./emoji.ts";
import { emphasis } from "./emphasis.ts";
import { fencedCode } from "./fenced-code.ts";
import { heading } from "./heading.ts";
import { highlight } from "./highlight.ts";
import { hr } from "./hr.ts";
import { htmlComment } from "./html-comment.ts";
import { image } from "./image.ts";
import { link } from "./link.ts";
import { list } from "./list.ts";
import { strike } from "./strike.ts";
import { subSup } from "./sub-sup.ts";
import { task } from "./task.ts";

export const ALL_FEATURES: FeatureSpec[] = [
  htmlComment,
  emoji,
  emphasis,
  code,
  strike,
  subSup,
  highlight,
  autolink,
  link,
  image,
  hr,
  blockquote,
  heading,
  // task before list so its Enter command runs first (chainCommands order).
  task,
  list,
  fencedCode,
  autoPair,
];

// Thin helpers that collect a named table from every feature. They are
// the only place the core modules touch the registry, so each seam stays
// declarative.

export function collectMarks(): NonNullable<FeatureSpec["marks"]> {
  return Object.assign({}, ...ALL_FEATURES.map((f) => f.marks ?? {}));
}
export function collectNodes(): NonNullable<FeatureSpec["nodes"]> {
  return Object.assign({}, ...ALL_FEATURES.map((f) => f.nodes ?? {}));
}
export function collectMdItPlugins(): NonNullable<FeatureSpec["mdItPlugins"]> {
  return ALL_FEATURES.flatMap((f) => f.mdItPlugins ?? []);
}
export function collectParserTokens(): NonNullable<FeatureSpec["parserTokens"]> {
  return Object.assign({}, ...ALL_FEATURES.map((f) => f.parserTokens ?? {}));
}
export function collectMarkDelims(): NonNullable<FeatureSpec["markDelims"]> {
  return Object.assign({}, ...ALL_FEATURES.map((f) => f.markDelims ?? {}));
}
export function collectRenderCases(): NonNullable<FeatureSpec["renderCases"]> {
  return Object.assign({}, ...ALL_FEATURES.map((f) => f.renderCases ?? {}));
}
export function collectInputRules(
  schema: Parameters<NonNullable<FeatureSpec["inputRules"]>>[0],
) {
  return ALL_FEATURES.flatMap((f) => f.inputRules?.(schema) ?? []);
}
export function collectBlockHandlers(): NonNullable<FeatureSpec["blockHandlers"]> {
  return Object.assign({}, ...ALL_FEATURES.map((f) => f.blockHandlers ?? {}));
}
export function collectInlineNodeHandlers(): NonNullable<FeatureSpec["inlineNodeHandlers"]> {
  return Object.assign({}, ...ALL_FEATURES.map((f) => f.inlineNodeHandlers ?? {}));
}
export function collectParserPostProcessors(): Array<NonNullable<FeatureSpec["parserPostProcess"]>> {
  return ALL_FEATURES.flatMap((f) => (f.parserPostProcess ? [f.parserPostProcess] : []));
}
// When multiple features bind the SAME key (e.g. fenced-code and list both
// claim Enter), we chain their commands in ALL_FEATURES order: each command
// gets to run its guard → action, and returning `false` falls through to the
// next. Without the chain, Object.assign would silently drop all but the
// last binding and whichever feature was registered last would win.
// Core baseKeymap is applied separately (and after) in editor.ts.
export function collectKeymaps(schema: Schema): Record<string, Command> {
  const byKey = new Map<string, Command[]>();
  for (const f of ALL_FEATURES) {
    const km = f.keymap?.(schema);
    if (!km) continue;
    for (const [key, cmd] of Object.entries(km)) {
      const arr = byKey.get(key) ?? [];
      arr.push(cmd);
      byKey.set(key, arr);
    }
  }
  const out: Record<string, Command> = {};
  for (const [key, cmds] of byKey)
    out[key] = cmds.length === 1 ? cmds[0]! : chainCommands(...cmds);
  return out;
}
export function collectPlugins(schema: Schema): Plugin[] {
  return ALL_FEATURES.flatMap((f) => f.plugins?.(schema) ?? []);
}
// Cases get namespaced by feature so ids stay unique across the app.
export function collectCases(): Array<Case & { feature: string }> {
  return ALL_FEATURES.flatMap((f) =>
    (f.cases ?? []).map((c) => ({ ...c, feature: f.name })),
  );
}
// Inline features, priority-sorted. Consumed by inline-parse orchestration,
// normalize (mark sync), decorations (which marks use the inline path),
// and serializer (per-feature no-escape extRanges).
export function collectInlineFeatures(): InlineFeatureSpec[] {
  return ALL_FEATURES
    .map((f) => f.inline)
    .filter((x): x is InlineFeatureSpec => x !== undefined)
    .sort((a, b) => a.priority - b.priority);
}
