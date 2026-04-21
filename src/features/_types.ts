// FeatureSpec — one file per Typora syntax.
//
// A feature contributes its pieces across every cross-cutting seam:
// schema (node/mark), parser (md-it plugin + token handlers), serializer
// (mark delimiters + block handlers), decorations (gray delim hints),
// input rules, and the test-pretty render map. Aggregation happens in
// features/index.ts; each core module reads from there.
//
// The shape is intentionally minimal — it will grow as real features
// require it. Optional fields stay undefined when a feature doesn't
// need them (inline marks don't need block handlers, etc.).

import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { InputRule } from "prosemirror-inputrules";
import type {
  MarkSpec as PMMarkSpec,
  NodeSpec as PMNodeSpec,
  Node as PMNode,
  Schema,
} from "prosemirror-model";

import type { Event } from "../events.ts";
import type { InlineSpan } from "../inline-parse.ts";
import type { ParserState } from "../parser.ts";
import type { MarkSpec as SerializerMarkSpec } from "../serializer.ts";

// A Case is one scripted scenario — seed text plus an event stream — with
// one or more Checkpoints along the way that assert pretty() output. One
// data shape, two consumers:
//   - the feature's test file runs each checkpoint as an independent test
//     (slice events up to cp.at, assert pretty equals cp.expect), so
//     intermediate invariants stay covered.
//   - main.ts lists each case as a single preset that plays the full event
//     stream; the harness can show cp.expect alongside as a visual oracle.
// This keeps "cases are the spec in both places" literal, not copy-pasted.
export type Checkpoint = {
  at: number;      // assert after the first `at` events have been fed (0 = seed state)
  expect: string;  // pretty() output at that point
};

export type Case = {
  id: string;
  label: string;
  seed: string;
  events: Event[];
  checkpoints: Checkpoint[];
};

export type TokenHandler = (
  state: ParserState,
  token: Token,
  schema: Schema,
) => void;

export type RenderCase = (children: string, el: Element) => string;

export type FeatureSpec = {
  name: string;
  marks?: Record<string, PMMarkSpec>;
  nodes?: Record<string, PMNodeSpec>;
  mdItPlugins?: Array<(md: MarkdownIt) => void>;
  parserTokens?: Record<string, TokenHandler>;
  markDelims?: Record<string, SerializerMarkSpec>;
  inputRules?: (schema: Schema) => InputRule[];
  renderCases?: Record<string, RenderCase>;
  cases?: Case[];
  inline?: InlineFeatureSpec;
};

// An inline feature contributes to the method-B parse/normalize/decoration/
// serialize pipeline. Each feature is a self-contained participant:
//
//   - scan: given the textblock's textContent and a "consumed" bitmap of
//     positions already claimed by higher-priority features, emit the
//     InlineSpans this feature recognises and update `consumed`.
//   - markNames: the PM mark types this feature produces. normalize syncs
//     these; decorations routes them through the inline path.
//   - extRanges: for a given textblock node, return char-offset ranges
//     (textblock-local) whose chars must NOT be escaped by the serializer —
//     typically content range ± delim length.
//
// priority is scan order (lower first). Code = 0, strike = 1, emphasis = 2.
export type InlineFeatureSpec = {
  priority: number;
  scan: (text: string, consumed: Uint8Array) => InlineSpan[];
  markNames: string[];
  extRanges: (parent: PMNode) => Array<[number, number]>;
};
