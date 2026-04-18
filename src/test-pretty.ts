// pretty is a projection of the real EditorView DOM:
//   - boot a real EditorView in headless DOM (happy-dom), let PM do
//     `toDOM` + decoration ordering itself
//   - recursively walk `view.dom`, map tags to our HTML-ish DSL:
//     <i>/<b>/<c>/<l:url>/<g>/|/[]
//   - no duplicated rendering — cursor side, decoration ordering and mark
//     nesting are all decided by PM
//
// As long as the real view renders correctly, the pretty snapshot is correct.
// And by construction, the snapshot can never drift away from the real view.

import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { collectRenderCases } from "./features/index.ts";

const featureRenderCases = collectRenderCases();

// ─────────────────────────────────────────────────────────────────────────────
// DOM → test DSL text
// ─────────────────────────────────────────────────────────────────────────────

function isElement(n: Node): n is Element {
  return n.nodeType === 1;
}
function isText(n: Node): n is Text {
  return n.nodeType === 3;
}

// Recursive render: input is any DOM node, output is the corresponding text.
function renderNode(n: Node): string {
  if (isText(n)) return n.data;
  if (!isElement(n)) return "";

  const el = n;
  const tag = el.tagName.toLowerCase();
  const list = el.classList;

  // Decoration widgets — PM also adds "ProseMirror-widget" to the class list,
  // so use classList.contains rather than a strict className comparison.
  if (tag === "span") {
    if (list.contains("syntax-hint")) return `<g>${el.textContent ?? ""}</g>`;
    if (list.contains("syntax-hidden")) return ""; // delim char present in text, visually hidden
    if (list.contains("play-caret")) return "|";
    if (list.contains("selection-marker")) return el.textContent ?? "";
  }

  // Trailing break PM injects for empty textblocks — not part of the doc content.
  if (tag === "br" && list.contains("ProseMirror-trailingBreak")) return "";

  const children = Array.from(el.childNodes).map(renderNode).join("");

  const featureCase = featureRenderCases[tag];
  if (featureCase) return featureCase(children, el);

  switch (tag) {
    case "p":
      return children;
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return `${"#".repeat(Number(tag[1]))} ${children}`;
    case "a": {
      const href = el.getAttribute("href") ?? "";
      return `<l:${href}>${children}</l>`;
    }
    case "br":
      return "<br/>";
    case "hr":
      return "---";
    case "blockquote":
      return children
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "pre": {
      // <pre data-lang="ts"><code>text</code></pre>
      const codeEl = el.querySelector("code");
      const lang = el.getAttribute("data-lang") ?? "";
      const text = codeEl?.textContent ?? "";
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case "ul":
    case "ol": {
      const isOrdered = tag === "ol";
      const startAttr = el.getAttribute("start");
      const start = startAttr ? Number(startAttr) : 1;
      return Array.from(el.children)
        .map((li, i) => {
          const liContent = renderNode(li);
          const prefix = isOrdered ? `${start + i}. ` : "- ";
          const indent = " ".repeat(prefix.length);
          return liContent
            .split("\n")
            .map((line, idx) => (idx === 0 ? prefix : indent) + line)
            .join("\n");
        })
        .join("\n");
    }
    case "li":
      return children; // parent ul/ol supplies the prefix
    default:
      return children;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry: render with a real EditorView, then stringify the DOM.
// ─────────────────────────────────────────────────────────────────────────────

export function pretty(state: EditorState): string {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const view = new EditorView(mount, { state });
  try {
    const blocks = Array.from(view.dom.children).map(renderNode);
    return blocks.join("\n").replace(/\n+$/, "");
  } finally {
    view.destroy();
    mount.remove();
  }
}
