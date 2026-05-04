import type { RuleBlock } from "markdown-it/lib/parser_block.mjs";
import { TextSelection } from "prosemirror-state";

import type { FeatureSpec } from "./_types.ts";

// YAML front matter — `---\n<content>\n---` at the very start of a doc.
//
// Live behavior:
//   * Typing `---` in the first paragraph then Enter converts that
//     paragraph into a yaml block; cursor lands inside the (initially
//     empty) block. (Keymap below; runs before paragraph split.)
//   * Inside the block: Enter inserts `\n` (default code-block behavior).
//     If the cursor is on an empty trailing line AND the previous line
//     is also empty, Enter exits — moves cursor to the paragraph below
//     the block (creating one if needed). Same exit pattern as fenced-
//     code's "double Enter at end".
//   * ArrowDown when cursor is on the last line exits to the block below.
//
// Storage: code-shaped block node `front_matter` (content: `text*`,
// code: true, marks: ""), DOM tag `<yaml-block>`. Round-trip emits
// `---\n<text>\n---`.

const frontMatterRule: RuleBlock = (state, startLine, endLine, silent) => {
  if (startLine !== 0) return false;
  if (state.tShift[startLine] !== 0) return false;
  const start = state.bMarks[startLine]!;
  const lineEnd = state.eMarks[startLine]!;
  if (lineEnd - start !== 3) return false;
  if (state.src.slice(start, start + 3) !== "---") return false;

  let closeLine = -1;
  for (let line = startLine + 1; line <= endLine; line++) {
    const bm = state.bMarks[line]!;
    const em = state.eMarks[line]!;
    if (state.tShift[line] === 0 && em - bm === 3 && state.src.slice(bm, em) === "---") {
      closeLine = line;
      break;
    }
  }
  if (closeLine === -1) return false;
  if (silent) return true;

  const content = state.src
    .slice(state.bMarks[startLine + 1]!, state.bMarks[closeLine]!)
    .replace(/\n$/, "");
  const token = state.push("front_matter", "div", 0);
  token.content = content;
  token.markup = "---";
  token.block = true;
  token.map = [startLine, closeLine + 1];
  state.line = closeLine + 1;
  return true;
};

export const frontMatter: FeatureSpec = {
  name: "front-matter",

  nodes: {
    front_matter: {
      group: "block",
      content: "text*",
      code: true,
      marks: "",
      defining: true,
      parseDOM: [
        {
          tag: "yaml-block",
          preserveWhitespace: "full",
        },
      ],
      toDOM: () => ["yaml-block", 0],
    },
  },

  mdItPlugins: [
    (md) => {
      md.block.ruler.before("hr", "front_matter", frontMatterRule, {
        alt: ["paragraph", "reference", "blockquote", "list"],
      });
    },
  ],

  parserTokens: {
    front_matter: (state, tok, schema) => {
      const content = tok.content;
      const textNodes = content ? [schema.text(content)] : [];
      state.push(schema.nodes.front_matter.createChecked({}, textNodes));
    },
  },

  blockHandlers: {
    front_matter: (state, node) => {
      state.write("---\n");
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
      state.write("\n---");
      state.closeBlock(node);
    },
  },

  keymap: (schema) => ({
    Enter: (state, dispatch) => {
      const sel = state.selection;
      if (!sel.empty) return false;
      const $from = sel.$from;
      const fmType = schema.nodes.front_matter;

      // Path 1: convert `---` paragraph at doc start to a yaml block.
      // Conditions: cursor is in a paragraph that's the very first child
      // of the doc, and the paragraph's text is exactly "---".
      if ($from.parent.type.name === "paragraph") {
        const inDocRoot = $from.depth === 1 && $from.index(0) === 0;
        if (inDocRoot && $from.parent.textContent === "---") {
          if (dispatch) {
            const fm = fmType.create();
            const paraStart = $from.before();
            const paraEnd = $from.after();
            const tr = state.tr;
            tr.replaceWith(paraStart, paraEnd, fm);
            // Cursor inside the (empty) yaml block.
            const inside = paraStart + 1;
            tr.setSelection(TextSelection.create(tr.doc, inside));
            dispatch(tr);
          }
          return true;
        }
      }

      // Path 2: inside yaml_block, exit on "double Enter at end".
      if ($from.parent.type === fmType) {
        const node = $from.parent;
        const text = node.textContent;
        const offset = $from.parentOffset;
        // Cursor must be at very end of the block content.
        if (offset === text.length) {
          // Trigger when content ends with `\n` (the user is on an empty
          // last line, a previous Enter already added a newline).
          if (text.endsWith("\n")) {
            if (dispatch) {
              // Strip the trailing `\n` we added on the previous Enter,
              // then move cursor to the position after the block. If the
              // block is the last child of doc, create a new paragraph.
              const tr = state.tr;
              const blockEnd = $from.after();
              // Remove the trailing newline.
              tr.delete(blockEnd - 2, blockEnd - 1);
              const newBlockEnd = blockEnd - 1;
              const docSize = tr.doc.content.size;
              if (newBlockEnd >= docSize) {
                const para = schema.nodes.paragraph.create();
                tr.insert(newBlockEnd, para);
              }
              // Place cursor inside the paragraph after the block.
              tr.setSelection(TextSelection.create(tr.doc, newBlockEnd + 1));
              dispatch(tr);
            }
            return true;
          }
        }
        // Otherwise fall through to baseKeymap's newlineInCode (inserts \n).
        return false;
      }

      return false;
    },

    ArrowDown: (state, dispatch) => {
      const sel = state.selection;
      if (!sel.empty) return false;
      const $from = sel.$from;
      const fmType = state.schema.nodes.front_matter;
      if ($from.parent.type !== fmType) return false;
      // Are we on the last line of content? Last line = no `\n` after
      // the cursor's offset.
      const text = $from.parent.textContent;
      const tail = text.slice($from.parentOffset);
      if (tail.includes("\n")) return false;
      if (dispatch) {
        const tr = state.tr;
        const blockEnd = $from.after();
        const docSize = tr.doc.content.size;
        if (blockEnd >= docSize) {
          const para = state.schema.nodes.paragraph.create();
          tr.insert(blockEnd, para);
        }
        tr.setSelection(TextSelection.create(tr.doc, blockEnd + 1));
        dispatch(tr);
      }
      return true;
    },
  }),

};
