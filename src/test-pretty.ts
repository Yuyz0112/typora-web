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
    if (list.contains("syntax-hint-italic"))
      return `<gi>${el.textContent ?? ""}</gi>`;
    if (list.contains("syntax-hidden")) return ""; // delim char present in text, visually hidden
    if (list.contains("task-marker-hidden")) return "";
    if (list.contains("play-caret")) return "|";
    if (list.contains("selection-marker")) return el.textContent ?? "";
    if (list.contains("image-icon"))
      return list.contains("broken") ? "<img-icon broken/>" : "<img-icon/>";
    if (list.contains("checkbox"))
      return el.getAttribute("data-checked") === "1"
        ? "<checkbox checked/>"
        : "<checkbox/>";
    if (list.contains("file-input")) return "<file-input/>";
  }
  if (tag === "img" && list.contains("image-render")) {
    const src = el.getAttribute("src") ?? "";
    const alt = el.getAttribute("alt") ?? "";
    return `<img:${src}>${alt}</img>`;
  }

  // Trailing break PM injects for empty textblocks — not part of the doc content.
  if (tag === "br" && list.contains("ProseMirror-trailingBreak")) return "";

  // Emoji autocomplete dropdown — collapsed to a self-closing tag in
  // pretty since the option list is dynamic and not the focus of the
  // assertion (presence/absence is what we test).
  if (list.contains("emoji-completion")) return "<select />";

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
      // Keep the tag so a rendered heading is distinguishable from a
      // paragraph whose text happens to start with `#{1,6} ` (method-B
      // draft state). `#` / level is already encoded in the tag name.
      return `<${tag}>${children}</${tag}>`;
    case "br":
      return "<br/>";
    case "hr":
      // Self-closing tag matches the convention used by other block
      // markers (<toc/>, <yaml-block .../>); avoids collision with a
      // paragraph whose text happens to be `---`.
      return "<hr/>";
    case "blockquote":
      // Same ambiguity fix as headings: a paragraph whose text starts
      // with `> ` would pretty-render identically to an actual
      // blockquote under the old `> ${line}` form. Wrap with <bq> and
      // join multi-block children by newline.
      return `<bq>${Array.from(el.children).map(renderNode).join("\n")}</bq>`;
    case "pre": {
      // <pre data-lang="ts"><code>text</code></pre>. Recurse through the
      // `<code>` child instead of reading textContent — textContent skips
      // zero-text widget spans (e.g. PM's play-caret), so we'd lose the
      // `|` marker when the cursor lives inside the code block.
      const codeEl = el.querySelector("code");
      const lang = el.getAttribute("data-lang") ?? "";
      const text = codeEl ? renderNode(codeEl) : "";
      return `\`\`\`${lang}\n${text}\n\`\`\``;
    }
    case "ul":
    case "ol": {
      // Explicit <ul>/<ol> + <li> nesting: list state is unambiguous (a
      // paragraph starting with `- ` would otherwise look identical to a
      // one-item bullet list), and the bullet/number is implied by the
      // tag rather than emitted as text. `<ol s=N>` carries non-default
      // start.
      const isOrdered = tag === "ol";
      const startAttr = el.getAttribute("start");
      const start = startAttr ? Number(startAttr) : 1;
      const inner = Array.from(el.children).map(renderNode).join("");
      const open = isOrdered
        ? start === 1
          ? "<ol>"
          : `<ol s=${start}>`
        : "<ul>";
      const close = isOrdered ? "</ol>" : "</ul>";
      return `${open}${inner}${close}`;
    }
    case "li": {
      // First block child is the item content. Non-first <p> children
      // are "bulletless trailing paragraphs" (staircase-exit intermediate
      // or CommonMark loose-list continuation) — wrap them in <li-tail>.
      // Nested ul/ol keep their own wrappers.
      const inner = Array.from(el.children)
        .map((child, i) => {
          const content = renderNode(child);
          if (i === 0) return content;
          return child.tagName.toLowerCase() === "p"
            ? `<li-tail>${content}</li-tail>`
            : content;
        })
        .join("");
      return `<li>${inner}</li>`;
    }
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
