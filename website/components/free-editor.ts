// Free editor — a single, freely-editable PM view with optional source
// mode (⌘/) and live pretty + md dumps.
//
// `mountFreeEditor(host, { initialMd })` builds the whole thing into
// `host` and returns a controller you can use to destroy / clear it
// when the route unmounts.

import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { defaultPlugins } from "../../src/editor.ts";
import { parse } from "../../src/parser.ts";
import { schema } from "../../src/schema.ts";
import { serialize } from "../../src/serializer.ts";
import { pretty } from "../../specs/pretty.ts";

export type FreeEditor = {
  el: HTMLElement;
  destroy(): void;
};

export function mountFreeEditor(
  host: HTMLElement,
  opts: { initialMd?: string; showDumps?: boolean } = {},
): FreeEditor {
  const showDumps = opts.showDumps ?? false;
  const wrap = document.createElement("div");
  wrap.className = "free-editor-wrap";
  wrap.innerHTML = `
    <div class="free-editor-host"></div>
    <textarea class="free-source" hidden></textarea>
    ${
      showDumps
        ? `<details class="free-dumps">
             <summary>pretty + md</summary>
             <pre class="free-pretty wrap-pre"></pre>
             <pre class="free-md wrap-pre"></pre>
           </details>`
        : ""
    }
  `;
  host.append(wrap);

  const $editor = wrap.querySelector(".free-editor-host") as HTMLDivElement;
  const $source = wrap.querySelector(".free-source") as HTMLTextAreaElement;
  const $pretty = wrap.querySelector(".free-pretty") as HTMLElement | null;
  const $md = wrap.querySelector(".free-md") as HTMLElement | null;

  let view: EditorView;
  let inSourceMode = false;

  function build(initialMd?: string): EditorView {
    const doc = initialMd ? parse(initialMd) : schema.nodes.doc.createAndFill()!;
    const base = EditorState.create({
      schema,
      doc,
      plugins: defaultPlugins({ cursorWidget: false }),
    });
    // Fire one no-op transaction so normalize's appendTransaction runs
    // and method-B marks (autolink, em, strong, code, etc.) get applied
    // before first render. EditorState.create alone runs `state.init`
    // but not `appendTransaction`, leaving parsed-from-seed docs without
    // their marks until the user types.
    const state = base.apply(
      base.tr.setSelection(TextSelection.atStart(doc)),
    );
    const v = new EditorView($editor, {
      state,
      dispatchTransaction(tr) {
        const next = v.state.apply(tr);
        v.updateState(next);
        if ($pretty) $pretty.textContent = pretty(next);
        if ($md) $md.textContent = serialize(next.doc);
      },
    });
    if ($pretty) $pretty.textContent = pretty(state);
    if ($md) $md.textContent = serialize(state.doc);
    return v;
  }

  view = build(opts.initialMd);

  function rebuild(md: string): void {
    view.destroy();
    $editor.innerHTML = "";
    view = build(md);
  }

  function enterSource(): void {
    $source.value = serialize(view.state.doc);
    $editor.hidden = true;
    $source.hidden = false;
    $source.focus();
    inSourceMode = true;
  }

  function exitSource(): void {
    rebuild($source.value);
    $source.hidden = true;
    $editor.hidden = false;
    view.focus();
    inSourceMode = false;
  }

  function toggleSource(): void {
    if (inSourceMode) exitSource();
    else enterSource();
  }

  // ⌘ / Ctrl + slash, scoped to this editor's DOM.
  function onKey(e: KeyboardEvent): void {
    if (e.key !== "/") return;
    const isMac = /Mac/.test(navigator.platform);
    if (!(isMac ? e.metaKey : e.ctrlKey)) return;
    if (e.shiftKey || e.altKey) return;
    const t = e.target as Element | null;
    if (!t) return;
    if (!$editor.contains(t) && t !== $source) return;
    e.preventDefault();
    toggleSource();
  }
  window.addEventListener("keydown", onKey);

  return {
    el: wrap,
    destroy(): void {
      window.removeEventListener("keydown", onKey);
      view.destroy();
      wrap.remove();
    },
  };
}
