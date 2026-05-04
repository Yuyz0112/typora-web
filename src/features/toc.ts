import type { Node as PMNode } from "prosemirror-model";
import { Plugin, TextSelection } from "prosemirror-state";
import type { EditorView, NodeView } from "prosemirror-view";

import type { FeatureSpec } from "./_types.ts";

// TOC `[toc]` (or `[TOC]`) — Typora extension.
//
// A doc-level atom block: source is `[toc]`, view renders a live list of
// every heading in the doc. The node carries no attrs; its NodeView walks
// the whole doc to build the list and re-renders on every transaction
// (a small plugin pings each live view when state changes).
//
// Conversion happens on Enter when the current paragraph's text is
// exactly `[toc]` or `[TOC]`. Outside of that, `[toc]` is plain text —
// matching the "回车前都是普通文字" spec.

// All currently-mounted TocNodeViews. The refresh plugin iterates this
// to re-render whenever the editor state changes (the toc node itself
// doesn't change when surrounding headings do, so we can't rely on PM's
// usual NodeView.update path alone).
const liveViews = new Set<TocNodeView>();

class TocNodeView implements NodeView {
  dom: HTMLElement;
  private view: EditorView;
  // Cache the last rendered (doc, items) so the refresh plugin can
  // bail out fast when nothing relevant to the TOC changed. Refresh
  // fires on every transaction (including selection-only); without
  // this, every keystroke re-walked the doc + rebuilt the DOM.
  private lastDoc: PMNode | null = null;
  private lastSig = "";

  constructor(_node: PMNode, view: EditorView) {
    this.view = view;
    this.dom = document.createElement("div");
    this.dom.className = "toc";
    this.dom.setAttribute("contenteditable", "false");
    this.render();
    liveViews.add(this);
  }

  render(): void {
    const doc = this.view.state.doc;
    if (doc === this.lastDoc) return; // selection-only tx → identical
    const items: { level: number; text: string; pos: number }[] = [];
    doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        items.push({
          level: node.attrs.level as number,
          text: node.textContent,
          pos,
        });
      }
    });

    // Cheap signature so doc-changed-but-no-headings-changed (e.g. typing
    // in a paragraph after the last heading) skips the DOM rebuild. Pos
    // is included so jumpTo handlers stay accurate when text inserted
    // earlier shifts later heading positions.
    const sig = items.map((it) => `${it.pos}\t${it.level}\t${it.text}`).join("\n");
    if (sig === this.lastSig && this.lastDoc !== null) {
      this.lastDoc = doc;
      return;
    }
    this.lastDoc = doc;
    this.lastSig = sig;

    this.dom.innerHTML = "";

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "toc-empty";
      empty.textContent = "(no headings yet)";
      this.dom.appendChild(empty);
      return;
    }

    const ul = document.createElement("ul");
    ul.className = "toc-list";
    for (const it of items) {
      const li = document.createElement("li");
      li.className = `toc-item toc-h${it.level}`;
      li.textContent = it.text || "(empty heading)";
      li.addEventListener("mousedown", (e) => {
        // Prevent PM from grabbing focus before our click runs.
        e.preventDefault();
      });
      li.addEventListener("click", () => this.jumpTo(it.pos));
      ul.appendChild(li);
    }
    this.dom.appendChild(ul);
  }

  private jumpTo(headingPos: number): void {
    const tr = this.view.state.tr;
    // Cursor at the start of the heading's text content.
    tr.setSelection(TextSelection.near(tr.doc.resolve(headingPos + 1)));
    this.view.dispatch(tr);
    // Scroll the heading itself to the top of the viewport. PM's
    // tr.scrollIntoView only nudges the cursor into a comfortable
    // band; for navigation we want the heading pinned at the top.
    // Hosts can offset for sticky chrome via `scroll-margin-top` on
    // their headings (the website does this for its sticky nav).
    const dom = this.view.nodeDOM(headingPos) as HTMLElement | null;
    dom?.scrollIntoView({ block: "start", behavior: "smooth" });
    this.view.focus();
  }

  // PM calls update on every transaction that touches the node or its
  // decorations. The node itself never changes (no attrs, atom, no
  // content), so this rarely fires from PM directly; the refresh plugin
  // calls render() externally instead. Returning true tells PM "we
  // handled it".
  update(): boolean {
    return true;
  }

  destroy(): void {
    liveViews.delete(this);
  }

  // Atom block — selectable and PM should treat the whole node as a unit.
  stopEvent(): boolean {
    // Let our own click handlers run; PM otherwise tries to translate
    // mouse events into selection moves into the node, which doesn't
    // make sense for an atom.
    return false;
  }

  ignoreMutation(): boolean {
    // We mutate `this.dom` ourselves on render; tell PM not to interpret
    // those as content changes.
    return true;
  }
}

function tocRefreshPlugin(): Plugin {
  return new Plugin({
    view() {
      const tick = (): void => {
        for (const v of liveViews) v.render();
      };
      // Schedule one tick after the next layout so first-mount catches up.
      tick();
      return {
        update() {
          tick();
        },
      };
    },
  });
}

export const toc: FeatureSpec = {
  name: "toc",

  nodes: {
    toc: {
      group: "block",
      atom: true,
      selectable: true,
      defining: true,
      // No attrs — the rendered content is derived from the doc's
      // headings each render, not stored on the node.
      parseDOM: [{ tag: "div.toc" }],
      toDOM: () => ["div", { class: "toc" }],
    },
  },

  plugins: () => [
    tocRefreshPlugin(),
    // NodeView registration goes here so `view.someProp("nodeViews")`
    // picks it up alongside other features.
    new Plugin({
      props: {
        nodeViews: {
          toc: (node, view) => new TocNodeView(node, view),
        },
      },
    }),
  ],

  keymap: () => ({
    // Convert paragraph `[toc]` / `[TOC]` to a toc node on Enter.
    Enter: (state, dispatch) => {
      const sel = state.selection;
      if (!sel.empty) return false;
      const $from = sel.$from;
      if ($from.parent.type.name !== "paragraph") return false;
      const text = $from.parent.textContent;
      if (text !== "[toc]" && text !== "[TOC]") return false;
      if (dispatch) {
        const schema = state.schema;
        const tocNode = schema.nodes.toc.create();
        const paraStart = $from.before();
        const paraEnd = $from.after();
        const tr = state.tr;
        // Replace the `[toc]` paragraph with toc + a fresh empty
        // paragraph so the cursor has somewhere to land.
        tr.replaceWith(paraStart, paraEnd, [
          tocNode,
          schema.nodes.paragraph.create(),
        ]);
        // Cursor in the new paragraph after the toc node.
        const newPos = paraStart + tocNode.nodeSize + 1;
        tr.setSelection(TextSelection.create(tr.doc, newPos));
        dispatch(tr);
      }
      return true;
    },
  }),

  // md-it parses `[toc]` as plain text (CommonMark has no toc rule). Walk
  // top-level blocks of the parsed doc and replace any paragraph whose
  // textContent is exactly `[toc]` or `[TOC]` with a toc node. We don't
  // recurse into blockquotes / list_items — TOC inside those is weird and
  // not part of the documented spec ("anywhere" is interpreted as "any
  // top-level position").
  parserPostProcess: (doc) => {
    const out: PMNode[] = [];
    let changed = false;
    const tocType = doc.type.schema.nodes.toc;
    if (!tocType) return doc;
    doc.forEach((child) => {
      if (
        child.type.name === "paragraph" &&
        (child.textContent === "[toc]" || child.textContent === "[TOC]")
      ) {
        out.push(tocType.create());
        changed = true;
      } else {
        out.push(child);
      }
    });
    if (!changed) return doc;
    return doc.type.create(doc.attrs, out, doc.marks);
  },

  blockHandlers: {
    toc: (state, node) => {
      // Output canonical lowercase form. Round-trip preserves doc shape
      // (toc node) — the source string is just a serialization detail.
      state.write("[toc]");
      state.closeBlock(node);
    },
  },

};
