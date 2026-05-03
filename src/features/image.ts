import type { Mark } from "prosemirror-model";
import { Plugin } from "prosemirror-state";

import { markConsumed, type InlineSpan } from "../inline-parse.ts";
import type { FeatureSpec, InlineFeatureSpec } from "./_types.ts";

// image in Typora-pilot (method B) mode.
//
// Source `![alt](src "title")` lives verbatim in the textblock text:
//   open delim  = `![`            (2 chars)
//   content     = alt             (image mark covers this range)
//   close delim = `](src "title")` or `](src)`
//
// Visibility model (different from link, matches Typora):
//   - cursor outside span: source chars hidden, an <img> widget at openFrom
//     renders the loaded image
//   - cursor inside span:  source chars visible (plain), an icon widget at
//     openFrom flags the line as image; if src is empty, a <file-input/>
//     widget sits between `(` and `)` so the user can pick a file
//
// We piggy-back on the existing softInside delim path to flip the source
// chars on and off, and on widgetDecorations to swap the img/icon UI.

const IMAGE_RE = /!\[([^\]]*?)\]\(([^\s)]*)(?:\s+"([^"]*)")?\)/g;

// Per-src load result. We only need to remember confirmed errors —
// "loading" and "ok" both render as a loaded image (optimistic), so we
// track only the negative case explicitly.
//
// Keyed by src string. Module-level so the scanner (run from normalize's
// computePlan) can read it without plumbing extra context, and the probe
// plugin can write it. setMeta on a state-only tr tells PM to re-run
// state.apply / appendTransaction so decorations re-emit.
type LoadStatus = "loading" | "ok" | "error";
const imageLoadStatus = new Map<string, LoadStatus>();
const IMAGE_LOAD_META = "image-load-status-changed";

const scan: InlineFeatureSpec["scan"] = (text, consumed) => {
  const out: InlineSpan[] = [];
  IMAGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMAGE_RE.exec(text))) {
    const fullStart = m.index;
    const fullEnd = fullStart + m[0].length;
    let blocked = false;
    for (let i = fullStart; i < fullEnd; i++) {
      if (consumed[i]) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;

    const openFrom = fullStart;
    const openTo = fullStart + 2; // after `![`
    const contentFrom = openTo;
    const contentTo = openTo + m[1]!.length;
    const closeFrom = contentTo;
    const closeTo = fullEnd;

    markConsumed(consumed, fullStart, fullEnd);
    const src = m[2]!;
    const title = m[3] ?? null;
    const alt = m[1]!;
    const span: InlineSpan = {
      type: "image",
      from: contentFrom,
      to: contentTo,
      openFrom,
      openTo,
      closeFrom,
      closeTo,
      attrs: { src, title },
      widgetDecorations: [],
    };

    // Edit-mode (file-input + source visible always) when:
    //   - src is empty
    //   - probe has confirmed src fails to load
    // Otherwise (probe pending or confirmed ok) render optimistically —
    // shows the image and only flashes back to edit-mode if a real load
    // error comes in. Avoids a long edit-mode delay on every valid image.
    const status = src === "" ? null : imageLoadStatus.get(src) ?? null;
    const editMode = src === "" || status === "error";
    // Icon side=1: caret at openFrom renders to the LEFT of the icon, so
    // ArrowLeft from inside the source can park the cursor before the icon
    // emoji. With side=-1 the caret ended up between icon and `!`, with no
    // way to navigate further left while still inside the textblock.
    const iconWidget = {
      pos: openFrom,
      kind: "image-icon",
      side: 1,
      attrs: status === "error" ? { broken: "1" } : undefined,
    };

    if (!editMode) {
      // Loaded image: <img> renders ALWAYS, placed at the END of the
      // source range so display:block puts it on a new line BELOW the
      // markdown text. softInside delim hides the source chars when the
      // cursor is outside; cursor inside reveals source for editing while
      // the image stays put underneath.
      span.delimRanges = [{ from: openFrom, to: closeTo, softInside: true }];
      span.widgetDecorations!.push(
        { ...iconWidget, when: "inside" } as never,
        {
          pos: closeTo,
          when: "always",
          kind: "image-render",
          attrs: { src, alt, ...(title ? { title } : {}) },
        },
      );
    } else {
      span.delimRanges = [];
      span.widgetDecorations!.push(
        { ...iconWidget, when: "always" } as never,
        { pos: closeFrom + 2, when: "always", kind: "file-input" },
      );
    }
    out.push(span);
  }
  return out;
};

// Wires up the file-input widget: when the user picks a file, read it as a
// data URL and insert that URL at the widget's stamped doc position. The
// data-pos attribute is added by decorations.buildWidget; it stays correct
// across rebuilds because the widget is recreated on every state change.
// Probes every image src found in the doc. On load/error, updates the
// shared status map and dispatches a meta-only tx to retrigger normalize/
// decorations so the span flips between image-mode and edit-mode.
function imageLoadProbePlugin(): Plugin {
  return new Plugin({
    view(editorView) {
      const probe = (src: string): void => {
        if (imageLoadStatus.has(src)) return;
        imageLoadStatus.set(src, "loading");
        const probeImg = new Image();
        const finish = (status: LoadStatus): void => {
          imageLoadStatus.set(src, status);
          // setMeta-only tx: nothing in doc changes, but state.apply runs
          // for normalize+decorations and the per-span editMode flag re-
          // evaluates with the new status.
          editorView.dispatch(editorView.state.tr.setMeta(IMAGE_LOAD_META, status));
        };
        probeImg.onload = (): void => finish("ok");
        probeImg.onerror = (): void => finish("error");
        probeImg.src = src;
      };
      const scanDoc = (): void => {
        editorView.state.doc.descendants((node) => {
          if (!node.isTextblock) return true;
          const text = node.textContent;
          IMAGE_RE.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = IMAGE_RE.exec(text))) {
            const src = m[2];
            if (src) probe(src);
          }
          return false;
        });
      };
      scanDoc();
      return {
        update: () => scanDoc(),
        destroy: () => {},
      };
    },
  });
}

function imageFileInputPlugin(): Plugin {
  return new Plugin({
    view(editorView) {
      const onPick = (e: Event): void => {
        const evt = e as CustomEvent<{ files: FileList | null }>;
        const trigger = evt.target as HTMLElement | null;
        if (!trigger?.classList?.contains("file-input")) return;
        const file = evt.detail?.files?.[0];
        if (!file) return;
        const posStr = trigger.getAttribute("data-pos");
        if (!posStr) return;
        const pos = Number(posStr);
        if (!Number.isFinite(pos)) return;
        // Use a blob URL instead of a base64 data URL — base64 dumps tens
        // of KB into the doc text per image, which is unreadable in the
        // source view and bloats the transaction. blob URLs are short,
        // session-scoped, and load directly into <img>. (Persisting across
        // reloads is a separate problem — out of scope for the pilot.)
        const url = URL.createObjectURL(file);
        editorView.dispatch(editorView.state.tr.insertText(url, pos));
      };
      editorView.dom.addEventListener("file-input-pick", onPick);
      return {
        destroy(): void {
          editorView.dom.removeEventListener("file-input-pick", onPick);
        },
      };
    },
  });
}

function closeDelimText(mark: Mark): string {
  const src = String(mark.attrs.src ?? "");
  const title = mark.attrs.title as string | null;
  return title
    ? `](${src} "${title.replace(/"/g, '\\"')}")`
    : `](${src})`;
}

export const image: FeatureSpec = {
  name: "image",

  marks: {
    image: {
      attrs: {
        src: { default: "" },
        title: { default: null },
      },
      inclusive: false,
      // toDOM/parseDOM must be a stable round-trip: PM's mutation observer
      // re-reads the DOM after every transaction, and if a toDOM-produced
      // element doesn't match any parseDOM rule, the mark is silently
      // dropped — normalize then re-applies it next tick, infinite loop.
      // We use a distinct `data-image-mark` marker so it can't collide
      // with anything else.
      parseDOM: [
        {
          tag: "span[data-image-mark]",
          getAttrs: (el) => ({
            src: (el as HTMLElement).getAttribute("data-src") ?? "",
            title: (el as HTMLElement).getAttribute("data-title"),
          }),
        },
      ],
      toDOM: (mark) => {
        const { src, title } = mark.attrs as { src: string; title: string | null };
        const attrs: Record<string, string> = { "data-image-mark": "" };
        if (src) attrs["data-src"] = src;
        if (title) attrs["data-title"] = title;
        return ["span", attrs, 0];
      },
    },
  },

  parserTokens: {
    image: (state, tok, schema) => {
      const src = tok.attrGet("src") ?? "";
      const title = tok.attrGet("title");
      // tok.content is the alt text (md-it joins child token text).
      const alt = tok.content;
      state.addText("![");
      state.openMark(schema.marks.image.create({ src, title: title || null }));
      state.addText(alt);
      state.closeMarkType(schema.marks.image);
      state.addText(
        title ? `](${src} "${title}")` : `](${src})`,
      );
    },
  },

  markDelims: {
    image: { open: "", close: "" },
  },

  plugins: () => [imageFileInputPlugin(), imageLoadProbePlugin()],

  inline: {
    // Before link: image's `![alt](url)` strictly contains link's `[alt](url)`
    // shape. Running image first lets it consume the whole match (including
    // the `!`) before link's regex sees the inner brackets. priority < link's 3.
    priority: 2.5,
    scan,
    markNames: ["image"],
    extRanges: (parent) => {
      const ranges: Array<[number, number]> = [];
      const imageType = parent.type.schema.marks.image;
      if (!imageType) return ranges;
      let start = -1;
      let currentMark: Mark | null = null;
      let off = 0;
      const flush = (end: number): void => {
        if (start < 0 || !currentMark) return;
        // open delim is `![` (2 chars), close varies.
        ranges.push([start - 2, end + closeDelimText(currentMark).length]);
        start = -1;
        currentMark = null;
      };
      parent.forEach((child) => {
        if (child.isText) {
          const m = child.marks.find((mk) => mk.type === imageType) ?? null;
          if (m) {
            if (start < 0) {
              start = off;
              currentMark = m;
            } else if (currentMark && !m.eq(currentMark)) {
              flush(off);
              start = off;
              currentMark = m;
            }
          } else {
            flush(off);
          }
        }
        off += child.nodeSize;
      });
      flush(off);
      return ranges;
    },
  },

};
