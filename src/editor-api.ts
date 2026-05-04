// Public façade. Consumers see only `createEditor()` and the small
// `Editor` controller it returns; ProseMirror is an implementation
// detail.
//
// Two surfaces are intentionally exposed:
//   - the high-level controller (getMarkdown / setMarkdown /
//     toggleSource / focus / destroy) is the supported API.
//   - `editor.view` is an escape hatch onto the underlying PM
//     EditorView for advanced cases (custom plugins, deep PM hooks).
//     Documented as "no warranty" — touching it is opt-in.
//
// Source-mode toggle (rendered ↔ raw markdown textarea) is built in.
// `⌘/` (Mac) or `Ctrl+/` (other) is wired automatically; consumers
// can also call `editor.toggleSource()` directly.

import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { defaultPlugins } from "./editor.ts";
import { parse } from "./parser.ts";
import { schema } from "./schema.ts";
import { serialize } from "./serializer.ts";

export interface EditorOptions {
  /** Initial markdown the editor opens with. Defaults to empty. */
  initialContent?: string;
  /** Fired on every document transaction; arg is the current markdown. Raw, no debounce. */
  onChange?: (md: string) => void;
  /** Fired when the editor surface (rendered or source) gains focus. */
  onFocus?: () => void;
  /** Fired when the editor surface loses focus. */
  onBlur?: () => void;
}

export interface Editor {
  /** Current markdown — renders source from the live PM doc, or returns the textarea contents in source mode. */
  getMarkdown(): string;
  /** Replace the document. Works in either rendered or source mode. */
  setMarkdown(md: string): void;
  /** Flip between rendered and raw-source views. ⌘/ does the same. */
  toggleSource(): void;
  /** Whether the editor is currently in raw-source mode. */
  isSourceMode(): boolean;
  /** Focus whichever surface is active. */
  focus(): void;
  /** Tear down the editor and remove its DOM. */
  destroy(): void;
  /** Escape hatch: the live ProseMirror view. Advanced; no API stability promised on this access. */
  readonly view: EditorView;
}

export function createEditor(
  host: HTMLElement,
  options: EditorOptions = {},
): Editor {
  const wrap = document.createElement("div");
  wrap.className = "typora-web-wrap";
  const editorHost = document.createElement("div");
  editorHost.className = "typora-web-editor-host";
  const sourceTextarea = document.createElement("textarea");
  sourceTextarea.className = "typora-web-source";
  sourceTextarea.hidden = true;
  wrap.append(editorHost, sourceTextarea);
  host.append(wrap);

  let view: EditorView;
  let inSource = false;

  function buildView(initialMd: string): EditorView {
    const doc = initialMd ? parse(initialMd) : schema.nodes.doc.createAndFill()!;
    const base = EditorState.create({
      schema,
      doc,
      plugins: defaultPlugins({ cursorWidget: false }),
    });
    // Fire one no-op transaction so normalize's appendTransaction runs
    // and method-B marks (em, strong, autolink, etc.) apply on first
    // render. EditorState.create alone runs `state.init` but not
    // `appendTransaction`, leaving parsed-from-seed docs with raw text.
    const state = base.apply(base.tr.setSelection(TextSelection.atStart(doc)));
    const v: EditorView = new EditorView(editorHost, {
      state,
      dispatchTransaction(tr) {
        const next = v.state.apply(tr);
        v.updateState(next);
        options.onChange?.(serialize(next.doc));
      },
      handleDOMEvents: {
        focus: () => { options.onFocus?.(); return false; },
        blur: () => { options.onBlur?.(); return false; },
      },
    });
    return v;
  }

  function rebuild(md: string): void {
    view.destroy();
    editorHost.innerHTML = "";
    view = buildView(md);
  }

  // Resize the source textarea to its content height. Called on every
  // input + on entering source mode so the page never shows a nested
  // scrollbar inside the textarea.
  function autoSizeSource(): void {
    sourceTextarea.style.height = "auto";
    sourceTextarea.style.height = `${sourceTextarea.scrollHeight}px`;
  }

  // Best-effort cursor mapping between rendered and source. Both
  // directions cut/parse a prefix and use its length / content.size as
  // the position. Mid-syntax cursors (e.g. between `*` and `bold` in
  // an unclosed `*bold`) may land a few chars off, but plain prose and
  // line boundaries are spot-on.
  function renderedCursorToMdOffset(): number {
    const sel = view.state.selection;
    try {
      const before = view.state.doc.cut(0, sel.from);
      return serialize(before).length;
    } catch {
      return serialize(view.state.doc).length;
    }
  }
  function mdOffsetToRenderedPos(md: string, offset: number): number {
    try {
      const beforeDoc = parse(md.slice(0, Math.max(0, offset)));
      return beforeDoc.content.size;
    } catch {
      return 0;
    }
  }

  function enterSource(): void {
    const md = serialize(view.state.doc);
    const mdCursor = renderedCursorToMdOffset();
    sourceTextarea.value = md;
    editorHost.hidden = true;
    sourceTextarea.hidden = false;
    autoSizeSource();
    sourceTextarea.focus();
    const clamped = Math.min(mdCursor, md.length);
    sourceTextarea.setSelectionRange(clamped, clamped);
    inSource = true;
  }

  function exitSource(): void {
    const md = sourceTextarea.value;
    const mdCursor = sourceTextarea.selectionStart ?? md.length;
    rebuild(md);
    const target = Math.min(
      mdOffsetToRenderedPos(md, mdCursor),
      view.state.doc.content.size,
    );
    try {
      view.dispatch(
        view.state.tr.setSelection(
          TextSelection.near(view.state.doc.resolve(target)),
        ),
      );
    } catch {}
    sourceTextarea.hidden = true;
    editorHost.hidden = false;
    view.focus();
    inSource = false;
  }

  // ⌘/ on Mac, Ctrl+/ elsewhere. Window-level keydown so it works
  // whether the editor or the source textarea has focus; gated on
  // event-target containment so multiple editors don't poach each
  // other's keystrokes.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "/") return;
    const isMac = /Mac/.test(navigator.platform);
    if (!(isMac ? e.metaKey : e.ctrlKey)) return;
    if (e.shiftKey || e.altKey) return;
    const t = e.target as Element | null;
    if (!t) return;
    if (!editorHost.contains(t) && t !== sourceTextarea) return;
    e.preventDefault();
    if (inSource) exitSource();
    else enterSource();
  };
  window.addEventListener("keydown", onKey);

  // Wire textarea focus/blur to the same callbacks as the editor.
  if (options.onFocus) {
    sourceTextarea.addEventListener("focus", () => options.onFocus!());
  }
  if (options.onBlur) {
    sourceTextarea.addEventListener("blur", () => options.onBlur!());
  }
  // Auto-grow the textarea as the user types so the page itself
  // owns the scroll, never the textarea.
  sourceTextarea.addEventListener("input", autoSizeSource);

  view = buildView(options.initialContent ?? "");

  return {
    getMarkdown(): string {
      return inSource ? sourceTextarea.value : serialize(view.state.doc);
    },
    setMarkdown(md: string): void {
      if (inSource) {
        sourceTextarea.value = md;
      } else {
        rebuild(md);
      }
    },
    toggleSource(): void {
      if (inSource) exitSource();
      else enterSource();
    },
    isSourceMode(): boolean {
      return inSource;
    },
    focus(): void {
      if (inSource) sourceTextarea.focus();
      else view.focus();
    },
    destroy(): void {
      window.removeEventListener("keydown", onKey);
      view.destroy();
      wrap.remove();
    },
    get view() {
      return view;
    },
  };
}
