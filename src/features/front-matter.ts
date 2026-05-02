import type { RuleBlock } from "markdown-it/lib/parser_block.mjs";

import type { FeatureSpec } from "./_types.ts";

// YAML front matter — `---\n<content>\n---` at the very start of a doc.
//
// Standard convention (Jekyll / Hugo / Typora): leading `---` line, then
// arbitrary content (typically YAML), then a closing `---` line. Only
// recognised at doc start; anywhere else `---` keeps its usual meaning
// (hr after a blank line, setext h2 underline after a paragraph).
//
// Stored as a code-block-shaped node `front_matter` (content: `text*`,
// code: true so PM treats it like an opaque text container — no inline
// marks, whitespace preserved). Round-trip emits `---\n<text>\n---`.

const frontMatterRule: RuleBlock = (state, startLine, endLine, silent) => {
  if (startLine !== 0) return false;
  // Require column 0 (no leading indent) and exact `---` content.
  if (state.tShift[startLine] !== 0) return false;
  const start = state.bMarks[startLine]!;
  const lineEnd = state.eMarks[startLine]!;
  if (lineEnd - start !== 3) return false;
  if (state.src.slice(start, start + 3) !== "---") return false;

  // Find the closing `---`. A bare `---` line wins; anything else
  // disqualifies the run (no fall-through to hr inside the body).
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

  const content = state.src.slice(state.bMarks[startLine + 1]!, state.bMarks[closeLine]!).replace(
    /\n$/,
    "",
  );
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
          // Custom tag — avoids collisions with fenced-code's <pre>
          // renderCase and toc's <div> renderCase. Custom elements are
          // HTMLUnknownElement (inline by default); CSS gives it block
          // display + code styling.
          tag: "front-matter",
          preserveWhitespace: "full",
        },
      ],
      toDOM: () => ["front-matter", 0],
    },
  },

  mdItPlugins: [
    (md) => {
      // Run before hr (so the leading `---` doesn't get claimed) and
      // before lheading (so it doesn't try to fold into a setext when
      // there's no preceding paragraph anyway, but defensive).
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
      // Standard `---\n<text>\n---` shape. The body chars get emitted
      // raw; no escaping (the node is `code: true`).
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

  renderCases: {
    "front-matter": (children) => `<fm>${children}</fm>`,
  },

  cases: [
    {
      id: "parse-from-seed",
      label: "front matter at doc start parses to front_matter node",
      seed: "---\ntitle: Hello\ndate: 2024-01-01\n---\n\nbody",
      events: [],
      checkpoints: [
        {
          at: 0,
          expect: "<fm>title: Hello\ndate: 2024-01-01</fm>\nbody|",
        },
      ],
    },
    {
      id: "no-close-falls-through",
      label: "leading `---` without a closing `---` is a hr (or setext)",
      seed: "---\n\nbody",
      events: [],
      checkpoints: [
        // Bare `---` not at doc start (here paragraph-less) becomes hr.
        { at: 0, expect: "---\nbody|" },
      ],
    },
    {
      id: "not-at-doc-start",
      label: "`---` after a paragraph is setext h2, not front matter",
      seed: "Title\n---\n\nbody",
      events: [],
      checkpoints: [
        { at: 0, expect: "<h2>Title</h2>\nbody|" },
      ],
    },
  ],
};
