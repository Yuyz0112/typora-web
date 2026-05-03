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
import type { Command, Plugin } from "prosemirror-state";

import type { InlineSpan } from "../inline-parse.ts";
import type { ParserState } from "../parser.ts";
import type {
  BlockHandler,
  MarkSpec as SerializerMarkSpec,
} from "../serializer.ts";

export type TokenHandler = (
  state: ParserState,
  token: Token,
  schema: Schema,
) => void;

export type FeatureSpec = {
  name: string;
  marks?: Record<string, PMMarkSpec>;
  nodes?: Record<string, PMNodeSpec>;
  mdItPlugins?: Array<(md: MarkdownIt) => void>;
  parserTokens?: Record<string, TokenHandler>;
  // Optional post-processor: runs once after parse() builds the doc, e.g.
  // to fold `[ ] ` text prefixes inside list_items into task_marker nodes.
  parserPostProcess?: (doc: PMNode) => PMNode;
  // Inline atom-node serializers — mirror blockHandlers but for inline
  // nodes. Called from serializer's renderInline before the default text/
  // hard-break path.
  inlineNodeHandlers?: Record<string, (state: import("../serializer.ts").SerializerState, node: PMNode) => void>;
  markDelims?: Record<string, SerializerMarkSpec>;
  // Block-level serializer handlers — one entry per node type the feature
  // contributes (or overrides). The core serializer has a fixed table for
  // paragraph / heading / blockquote / lists / code_block / horizontal_rule;
  // features can add new node types here, or (in principle) override a core
  // entry when migrating.
  blockHandlers?: Record<string, BlockHandler>;
  inputRules?: (schema: Schema) => InputRule[];
  // Block-level interactions (Enter to exit an empty blockquote, Backspace
  // to unwrap a heading, etc.). Merged before baseKeymap so features win.
  keymap?: (schema: Schema) => Record<string, Command>;
  // Escape hatch for feature-owned PM plugins: leave-line draft watchers,
  // NodeViews (via Plugin.props.nodeViews), DOM event handlers for custom
  // UI overlays. Anything that doesn't fit inputRules / keymap / normalize.
  plugins?: (schema: Schema) => Plugin[];
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
  scan: (
    text: string,
    consumed: Uint8Array,
    parentBlock?: PMNode | null,
  ) => InlineSpan[];
  markNames: string[];
  extRanges: (parent: PMNode) => Array<[number, number]>;
};
