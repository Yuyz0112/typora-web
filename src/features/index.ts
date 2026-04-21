// Single registry of all Typora-syntax features. Each core module reads
// exactly from here — adding a feature means one import + one array entry.

import type { Command, Plugin } from "prosemirror-state";
import type { Schema } from "prosemirror-model";

import type { Case, FeatureSpec, InlineFeatureSpec } from "./_types.ts";
import { blockquote } from "./blockquote.ts";
import { code } from "./code.ts";
import { emphasis } from "./emphasis.ts";
import { fencedCode } from "./fenced-code.ts";
import { heading } from "./heading.ts";
import { hr } from "./hr.ts";
import { link } from "./link.ts";
import { list } from "./list.ts";
import { strike } from "./strike.ts";

// heading / list / fencedCode are cases-only stubs for now — registered
// here so their scripts surface in the harness (collectCases), even
// though the feature plugins haven't landed yet. Their tests stay red
// until implementation. hr and blockquote are fully implemented.
export const ALL_FEATURES: FeatureSpec[] = [
  emphasis,
  code,
  strike,
  link,
  hr,
  blockquote,
  heading,
  list,
  fencedCode,
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
// Merge each feature's keymap contribution; last writer wins on collision.
// Core baseKeymap is applied separately (and after) in editor.ts.
export function collectKeymaps(schema: Schema): Record<string, Command> {
  return Object.assign({}, ...ALL_FEATURES.map((f) => f.keymap?.(schema) ?? {}));
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
