import MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import {
  Mark,
  type Attrs,
  type MarkType,
  type Node as PMNode,
  type NodeType,
} from "prosemirror-model";

import {
  collectMdItPlugins,
  collectParserPostProcessors,
  collectParserTokens,
} from "./features/index.ts";
import { schema } from "./schema.ts";

const md: MarkdownIt = new MarkdownIt("commonmark", { html: false });
for (const plugin of collectMdItPlugins()) md.use(plugin);

// Preserve trailing whitespace inside paragraphs.
//
// The default paragraph rule does `state.getLines(...).trim()` on the
// final content, which discards trailing spaces. That breaks lossless
// round-trip — md text `"[a](url) "` would parse to a doc whose text is
// `"[a](url)"`, dropping a real source char. We replace the rule with
// the same logic minus the trim, since the only whitespace we'd want to
// strip (leading indent, trailing newline) is already handled by
// `blkIndent` and getLines' `keepLastLF=false`.
md.block.ruler.at("paragraph", function paragraphPreserveTrailing(state, startLine, endLine) {
  const terminatorRules = state.md.block.ruler.getRules("paragraph");
  const oldParentType = state.parentType;
  let nextLine = startLine + 1;
  state.parentType = "paragraph";

  for (; nextLine < endLine && !state.isEmpty(nextLine); nextLine++) {
    if (state.sCount[nextLine] - state.blkIndent > 3) continue;
    if (state.sCount[nextLine] < 0) continue;
    let terminate = false;
    for (let i = 0; i < terminatorRules.length; i++) {
      if (terminatorRules[i]!(state, nextLine, endLine, true)) {
        terminate = true;
        break;
      }
    }
    if (terminate) break;
  }

  const content = state.getLines(startLine, nextLine, state.blkIndent, false);
  state.line = nextLine;

  state.push("paragraph_open", "p", 1).map = [startLine, state.line];
  const token_i = state.push("inline", "", 0);
  token_i.content = content;
  token_i.map = [startLine, state.line];
  token_i.children = [];
  state.push("paragraph_close", "p", -1);

  state.parentType = oldParentType;
  return true;
});

const featureTokens = collectParserTokens();

type Frame = { type: NodeType; attrs: Attrs | null; content: PMNode[] };

export class ParserState {
  private stack: Frame[] = [{ type: schema.nodes.doc, attrs: null, content: [] }];
  private marks: readonly Mark[] = Mark.none;

  private top(): Frame {
    return this.stack[this.stack.length - 1]!;
  }

  push(node: PMNode): void {
    this.top().content.push(node);
  }

  addText(text: string): void {
    if (!text) return;
    this.top().content.push(schema.text(text, this.marks));
  }

  openMark(mark: Mark): void {
    this.marks = mark.addToSet(this.marks);
  }

  closeMarkType(type: MarkType): void {
    this.marks = this.marks.filter((m) => m.type !== type);
  }

  // Peek the currently-open mark of a given type (so a close-handler can
  // read attrs before closing — link needs href for its close delim).
  topMark(type: MarkType): Mark | undefined {
    return this.marks.find((m) => m.type === type);
  }

  openNode(type: NodeType, attrs: Attrs | null = null): void {
    this.stack.push({ type, attrs, content: [] });
  }

  closeNode(): void {
    const frame = this.stack.pop();
    if (!frame) throw new Error("closeNode: stack underflow");
    const node = frame.type.createAndFill(frame.attrs, frame.content);
    if (!node) throw new Error(`parser: cannot fill <${frame.type.name}>`);
    this.top().content.push(node);
  }

  finish(): PMNode {
    while (this.stack.length > 1) this.closeNode();
    const root = this.stack[0]!;
    const doc = root.type.createAndFill(null, root.content);
    if (!doc) throw new Error("parser: cannot build doc");
    return doc;
  }
}

function handleBlock(state: ParserState, token: Token): void {
  const { nodes } = schema;
  switch (token.type) {
    case "paragraph_open":
      state.openNode(nodes.paragraph);
      return;
    case "paragraph_close":
      state.closeNode();
      return;
    case "heading_open": {
      // markdown-it sets token.markup to "#"/"##"/... for ATX and "="/"-"
      // for setext (lheading). We capture it as a `style` attr so the
      // serializer can emit the same shape on round-trip.
      const markup = token.markup;
      const style = markup === "=" || markup === "-" ? "setext" : "atx";
      state.openNode(nodes.heading, {
        level: Number(token.tag.slice(1)),
        style,
      });
      return;
    }
    case "heading_close":
      state.closeNode();
      return;
    case "blockquote_open":
      state.openNode(nodes.blockquote);
      return;
    case "blockquote_close":
      state.closeNode();
      return;
    case "bullet_list_open":
      state.openNode(nodes.bullet_list);
      return;
    case "bullet_list_close":
      state.closeNode();
      return;
    case "ordered_list_open": {
      const raw = token.attrGet("start");
      state.openNode(nodes.ordered_list, { start: raw ? Number(raw) : 1 });
      return;
    }
    case "ordered_list_close":
      state.closeNode();
      return;
    case "list_item_open":
      state.openNode(nodes.list_item);
      return;
    case "list_item_close":
      state.closeNode();
      return;
    case "fence": {
      const content = token.content.replace(/\n$/, "");
      const textNodes = content ? [schema.text(content)] : [];
      state.push(nodes.code_block.createChecked({ lang: token.info.trim() }, textNodes));
      return;
    }
    case "code_block": {
      const content = token.content.replace(/\n$/, "");
      const textNodes = content ? [schema.text(content)] : [];
      state.push(nodes.code_block.createChecked({ lang: "" }, textNodes));
      return;
    }
    case "hr":
      state.push(nodes.horizontal_rule.create());
      return;
    case "inline": {
      for (const child of token.children ?? []) handleInline(state, child);
      return;
    }
    default: {
      const handler = featureTokens[token.type];
      if (handler) handler(state, token, schema);
      return;
    }
  }
}

function handleInline(state: ParserState, token: Token): void {
  const { nodes } = schema;
  switch (token.type) {
    case "text":
      state.addText(token.content);
      return;
    case "softbreak":
      // Preserve md soft-wrap newlines as "\n" so the serializer round-trips them
      state.addText("\n");
      return;
    case "hardbreak":
      state.push(nodes.hard_break.create());
      return;
    default: {
      const handler = featureTokens[token.type];
      if (handler) handler(state, token, schema);
      return;
    }
  }
}

export function parse(src: string): PMNode {
  const tokens = md.parse(src, {});
  const state = new ParserState();
  for (const token of tokens) handleBlock(state, token);
  let doc = state.finish();
  for (const f of collectParserPostProcessors()) doc = f(doc);
  return doc;
}
