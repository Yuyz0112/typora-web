// Single registry of all Typora-syntax features. Each core module reads
// exactly from here — adding a feature means one import + one array entry.

import type { Case, FeatureSpec, InlineFeatureSpec } from "./_types.ts";
import { code } from "./code.ts";
import { emphasis } from "./emphasis.ts";
import { strike } from "./strike.ts";

export const ALL_FEATURES: FeatureSpec[] = [emphasis, code, strike];

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
export function collectDecorationDelims(): NonNullable<FeatureSpec["decorationDelims"]> {
  return Object.assign({}, ...ALL_FEATURES.map((f) => f.decorationDelims ?? {}));
}
export function collectRenderCases(): NonNullable<FeatureSpec["renderCases"]> {
  return Object.assign({}, ...ALL_FEATURES.map((f) => f.renderCases ?? {}));
}
export function collectInputRules(
  schema: Parameters<NonNullable<FeatureSpec["inputRules"]>>[0],
) {
  return ALL_FEATURES.flatMap((f) => f.inputRules?.(schema) ?? []);
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
