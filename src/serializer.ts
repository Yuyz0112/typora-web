import type { Mark, Node as PMNode } from "prosemirror-model";

import {
  collectBlockHandlers,
  collectInlineFeatures,
  collectInlineNodeHandlers,
  collectMarkDelims,
} from "./features/index.ts";
import { schema } from "./schema.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Configurable surface: mark delimiters and character escaping. md and pretty
// share the block-level walk and only diverge at these two points.
// ─────────────────────────────────────────────────────────────────────────────

export type MarkSpec = {
  open: string | ((node: PMNode) => string);
  close: string | ((mark: Mark) => string);
};

export type SerializerConfig = {
  marks: Record<string, MarkSpec>;
  escapeInline: (ch: string) => string;
  escapeBlockStart: (ch: string) => string;
  // Whether the code mark emits via a dynamic backtick fence (md behaviour).
  // When false, the code mark goes through the regular open/close channel.
  codeMarkAsBacktickFence: boolean;
};

// md configuration
const mdEscapeInline = (ch: string): string =>
  /[\\`*_\[\]<>]/.test(ch) ? `\\${ch}` : ch;
const mdEscapeBlockStart = (ch: string): string =>
  /[#\->+*_]/.test(ch) ? `\\${ch}` : mdEscapeInline(ch);

const coreMdMarks: Record<string, MarkSpec> = {};

export const mdConfig: SerializerConfig = {
  marks: { ...coreMdMarks, ...collectMarkDelims() },
  escapeInline: mdEscapeInline,
  escapeBlockStart: mdEscapeBlockStart,
  // Under method-B the `` ` `` delim chars live in the textblock text, so
  // the standard mark-open/close channel (with empty code markDelims) plus
  // the extRanges no-escape is enough. The backtick-fence path stays in
  // the code for potential non-md consumers that set it back to true.
  codeMarkAsBacktickFence: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Position markers: inject a character at a PM position. `side` picks which
// boundary of a mark we fire at:
//   inner → after mark open / before mark close / block edges / before each char
//           (used by the cursor — prefers to render just outside mark tags)
//   outer → before mark open / after mark close
//           (used by decoration gray-delim hints)
// ─────────────────────────────────────────────────────────────────────────────

export type PosMarker = { pos: number; char: string; side?: "inner" | "outer" };

type InternalMarker = PosMarker & { side: "inner" | "outer"; done: boolean };

// ─────────────────────────────────────────────────────────────────────────────

export class SerializerState {
  out = "";
  delim = "";
  private closed: PMNode | null = null;

  pmPos = 0;
  markers: InternalMarker[];
  config: SerializerConfig;

  constructor(config: SerializerConfig, markers: readonly PosMarker[] = []) {
    this.config = config;
    this.markers = markers.map((m) => ({ ...m, side: m.side ?? "inner", done: false }));
  }

  tick(side: "inner" | "outer"): void {
    for (const m of this.markers) {
      if (!m.done && m.side === side && m.pos === this.pmPos) {
        this.out += m.char;
        m.done = true;
      }
    }
  }

  advance(n: number): void {
    this.pmPos += n;
  }

  atBlankLine(): boolean {
    return this.out === "" || this.out.endsWith("\n");
  }

  flushClose(tight = false): void {
    if (!this.closed) return;
    if (!this.atBlankLine()) this.out += "\n";
    if (!tight) {
      const trimmed = this.delim.replace(/\s+$/, "");
      this.out += trimmed + "\n";
    }
    this.closed = null;
  }

  write(content = ""): void {
    this.flushClose();
    if (this.delim && this.atBlankLine()) this.out += this.delim;
    if (content) this.out += content;
  }

  closeBlock(node: PMNode): void {
    this.closed = node;
  }

  wrapBlock(delim: string, firstDelim: string | null, node: PMNode, f: () => void): void {
    const old = this.delim;
    this.write(firstDelim ?? delim);
    this.delim += delim;
    f();
    this.delim = old;
    this.closeBlock(node);
  }

  renderDoc(doc: PMNode): void {
    doc.forEach((child) => this.renderBlock(child));
  }

  renderBlock(node: PMNode): void {
    this.advance(1);
    const handler = blockHandlers[node.type.name];
    if (!handler) throw new Error(`serializer: no handler for <${node.type.name}>`);
    handler(this, node);
    this.advance(1);
  }

  renderBlockChildren(parent: PMNode): void {
    this.tick("inner"); // A
    parent.forEach((child) => this.renderBlock(child));
    this.tick("inner"); // E
  }

  renderInline(parent: PMNode): void {
    this.tick("inner"); // A
    let active: readonly Mark[] = [];
    const marks = this.config.marks;

    // Under method-B, each inline feature declares which char ranges are
    // its source delim + content (extRanges). Inside these ranges the text
    // already encodes md, so backslash escape must be suppressed.
    const extRanges: Array<[number, number]> = collectInlineFeatures().flatMap((f) =>
      f.extRanges(parent),
    );
    let blockOffset = 0;
    const insideEmStrong = (o: number): boolean => {
      for (const [a, b] of extRanges) if (o >= a && o < b) return true;
      return false;
    };

    // We deliberately do not fire "inner" ticks during mark transitions —
    // the cursor only fires at A/B/E (block edges or text chars). That keeps
    // a cursor exactly on a mark boundary on the visual outside of the mark,
    // matching Typora's behaviour.
    const closeMarks = (next: readonly Mark[]): void => {
      while (active.length > 0) {
        const innermost = active[active.length - 1]!;
        if (next.some((m) => m.eq(innermost))) break;
        const sp = marks[innermost.type.name];
        if (sp) this.out += typeof sp.close === "function" ? sp.close(innermost) : sp.close;
        active = active.slice(0, -1);
        this.tick("outer"); // D_post: after close delim — gray close fires here
      }
    };
    const openMarks = (next: readonly Mark[], forNode: PMNode): void => {
      for (const mark of next) {
        if (active.some((m) => m.eq(mark))) continue;
        this.tick("outer"); // C_pre: before open delim — gray open fires here
        const sp = marks[mark.type.name];
        if (sp) this.out += typeof sp.open === "function" ? sp.open(forNode) : sp.open;
        active = [...active, mark];
      }
    };

    parent.forEach((child) => {
      // In md, the code mark wraps the text with a dynamic backtick fence
      // rather than going through the standard mark open/close channel.
      const codeMark = child.marks.find((m) => m.type === schema.marks.code);
      if (codeMark && this.config.codeMarkAsBacktickFence) {
        closeMarks([]);
        this.write();
        const content = child.text ?? "";
        const runs = content.match(/`+/g) ?? [];
        const fenceLen = runs.reduce((max, r) => Math.max(max, r.length), 0) + 1;
        const fence = "`".repeat(fenceLen);
        const pad = content.startsWith("`") || content.endsWith("`") ? " " : "";
        this.out += fence + pad;
        this.tick("inner");
        for (const ch of content) {
          this.tick("inner");
          this.out += ch;
          this.advance(1);
          blockOffset++;
        }
        this.tick("inner");
        this.out += pad + fence;
        return;
      }

      // Feature-contributed inline atom nodes (e.g. task_marker) — they
      // serialize to a fixed text shape and don't carry marks.
      const inlineHandler = inlineNodeHandlers[child.type.name];
      if (inlineHandler) {
        closeMarks([]);
        this.write();
        inlineHandler(this, child);
        // Atom nodes occupy 1 position in the textblock; track block offset.
        blockOffset += child.nodeSize;
        return;
      }

      if (child.type === schema.nodes.hard_break) {
        closeMarks([]);
        this.write();
        this.tick("inner");
        this.out += "  \n";
        if (this.delim) this.out += this.delim;
        this.advance(1);
        return; // hard_break doesn't contribute to textContent offsets
      }

      if (!child.isText) return;

      closeMarks(child.marks);
      this.write();
      openMarks(child.marks, child);

      const raw = child.text ?? "";
      const atBlockStart = this.atBlankLine() && active.length === 0;
      let sawNonNewline = false;
      for (const ch of raw) {
        this.tick("inner");
        if (ch === "\n") {
          this.out += "\n";
          if (this.delim) this.out += this.delim;
        } else if (insideEmStrong(blockOffset)) {
          this.out += ch; // raw — char already encodes md source
          sawNonNewline = true;
        } else {
          const needBlockEsc = atBlockStart && !sawNonNewline;
          this.out += needBlockEsc
            ? this.config.escapeBlockStart(ch)
            : this.config.escapeInline(ch);
          sawNonNewline = true;
        }
        blockOffset++;
        this.advance(1);
      }
    });

    closeMarks([]);
    this.tick("inner"); // E
  }
}

// ─────────────────────────────────────────────────────────────────────────────

export type BlockHandler = (state: SerializerState, node: PMNode) => void;

const coreBlockHandlers: Record<string, BlockHandler> = {
  paragraph: (state, node) => {
    state.renderInline(node);
    state.closeBlock(node);
  },

  heading: (state, node) => {
    const level = node.attrs.level as number;
    const style = node.attrs.style as string;
    if (style === "setext" && (level === 1 || level === 2)) {
      // setext: content on one line, underline of `=`/`-` (3 chars,
      // canonical) on the next. Only valid for h1/h2 — higher levels
      // fall through to ATX.
      state.renderInline(node);
      state.write(`\n${level === 1 ? "===" : "---"}`);
      state.closeBlock(node);
      return;
    }
    state.write(`${"#".repeat(level)} `);
    state.renderInline(node);
    state.closeBlock(node);
  },

  blockquote: (state, node) => {
    state.wrapBlock("> ", null, node, () => state.renderBlockChildren(node));
  },

  code_block: (state, node) => {
    const lang = String(node.attrs.lang ?? "");
    state.write("```" + lang + "\n");
    state.tick("inner");
    for (const ch of node.textContent) {
      state.tick("inner");
      if (ch === "\n") {
        state.out += "\n";
        if (state.delim) state.out += state.delim;
      } else {
        state.out += ch;
      }
      state.advance(1);
    }
    state.tick("inner");
    state.write("\n```");
    state.closeBlock(node);
  },

  horizontal_rule: (state, node) => {
    state.write("---");
    state.closeBlock(node);
  },

  bullet_list: (state, node) => {
    state.tick("inner");
    node.forEach((item, _, i) => {
      if (i > 0) state.flushClose(true);
      state.wrapBlock("  ", "- ", item, () => state.renderBlockChildren(item));
    });
    state.tick("inner");
  },

  ordered_list: (state, node) => {
    const start = (node.attrs.start as number) ?? 1;
    const maxNum = String(start + node.childCount - 1);
    const pad = maxNum.length;
    state.tick("inner");
    node.forEach((item, _, i) => {
      if (i > 0) state.flushClose(true);
      const label = String(start + i);
      const padded = `${label}. ${" ".repeat(Math.max(0, pad - label.length))}`;
      const delim = " ".repeat(pad + 2);
      state.wrapBlock(delim, padded, item, () => state.renderBlockChildren(item));
    });
    state.tick("inner");
  },

  list_item: (state, node) => {
    state.renderBlockChildren(node);
  },
};

// Feature-contributed block handlers win over core when names collide (lets
// a feature migrate a core node type wholesale, not yet exercised).
const inlineNodeHandlers: NonNullable<
  ReturnType<typeof collectInlineNodeHandlers>
> = collectInlineNodeHandlers();

const blockHandlers: Record<string, BlockHandler> = {
  ...coreBlockHandlers,
  ...collectBlockHandlers(),
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function serialize(doc: PMNode): string {
  const state = new SerializerState(mdConfig);
  state.renderDoc(doc);
  return state.out.replace(/\n+$/, "\n");
}

export function serializeWith(
  doc: PMNode,
  config: SerializerConfig,
  markers: readonly PosMarker[] = [],
): string {
  const state = new SerializerState(config, markers);
  state.renderDoc(doc);
  const leftover = state.markers
    .filter((m) => !m.done)
    .map((m) => m.char)
    .join("");
  return state.out + leftover;
}
