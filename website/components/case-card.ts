// Per-case card — a self-contained replay harness with one EditorView,
// step / play / reset controls, and live pretty + md dumps.
//
// Each card owns its own ticker; cards don't coordinate. The shared
// `getSpeed` getter lets a global slider influence every card's play
// rate without a re-mount.

import type { Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { defaultPlugins } from "../../src/editor.ts";
import { parse } from "../../src/parser.ts";
import { schema } from "../../src/schema.ts";
import { serialize } from "../../src/serializer.ts";
import { feedEvent, type Event } from "../../specs/events.ts";
import { pretty } from "../../specs/pretty.ts";

export type Script = {
  id: string;
  label: string;
  seed: string;
  events: Event[];
};

export type CaseCard = {
  el: HTMLElement;
  destroy(): void;
};

export function createCaseCard(
  script: Script,
  getSpeed: () => number,
): CaseCard {
  const el = document.createElement("div");
  el.className = "case-card";
  el.innerHTML = `
    <div class="case-head">
      <code class="case-label"></code>
      <div class="case-controls">
        <button data-act="reset" title="Reset">↺</button>
        <button data-act="step" title="Step">▸</button>
        <button data-act="play" title="Play">▶</button>
        <span class="case-progress"></span>
        <code class="case-next"></code>
      </div>
    </div>
    <div class="case-body">
      <div class="case-editor"></div>
      <details class="case-dumps">
        <summary>pretty + md</summary>
        <div class="dump-wrap">
          <button class="copy-btn copy-btn-corner" data-copy-sibling="pretty">copy</button>
          <pre class="case-pretty wrap-pre"></pre>
        </div>
        <div class="dump-wrap">
          <button class="copy-btn copy-btn-corner" data-copy-sibling="md">copy</button>
          <pre class="case-md wrap-pre"></pre>
        </div>
      </details>
    </div>
  `;
  (el.querySelector(".case-label") as HTMLElement).textContent = script.label;

  const $editor = el.querySelector(".case-editor") as HTMLDivElement;
  const $pretty = el.querySelector(".case-pretty") as HTMLElement;
  const $md = el.querySelector(".case-md") as HTMLElement;
  const $progress = el.querySelector(".case-progress") as HTMLElement;
  const $next = el.querySelector(".case-next") as HTMLElement;
  const $reset = el.querySelector('[data-act="reset"]') as HTMLButtonElement;
  const $step = el.querySelector('[data-act="step"]') as HTMLButtonElement;
  const $play = el.querySelector('[data-act="play"]') as HTMLButtonElement;

  let view: EditorView | null = null;
  let cursorIndex = 0;
  let playTimer: number | null = null;

  function mount(): void {
    const doc: PMNode = script.seed
      ? parse(script.seed)
      : schema.nodes.doc.createAndFill()!;
    // Match tests/utils.ts:setup — cursor at doc end after seed parse.
    // List staircase cases (seed `- a\n  - b`) need this; otherwise the
    // events run from the wrong starting cursor and produce visibly
    // wrong DOM.
    const base = EditorState.create({
      schema,
      doc,
      selection: TextSelection.atEnd(doc),
      plugins: defaultPlugins(),
    });
    // Fire one no-op transaction to trigger normalize before first
    // render so method-B marks are applied. (See free-editor.ts.)
    const state = base.apply(base.tr.setSelection(base.selection));
    if (view) view.destroy();
    view = new EditorView($editor, { state });
    cursorIndex = 0;
    redraw();
  }

  function redraw(): void {
    if (!view) return;
    const done = cursorIndex >= script.events.length;
    $progress.textContent = `${cursorIndex}/${script.events.length}`;
    $next.textContent = done ? "—" : String(script.events[cursorIndex]!);
    $pretty.textContent = pretty(view.state);
    $md.textContent = serialize(view.state.doc);
    $step.disabled = done;
    $play.disabled = done;
    el.classList.toggle("done", done);
  }

  function stepOnce(): boolean {
    if (!view) return false;
    if (cursorIndex >= script.events.length) return false;
    feedEvent(view, script.events[cursorIndex]!);
    cursorIndex++;
    redraw();
    return cursorIndex < script.events.length;
  }

  function setPlaying(on: boolean): void {
    if (playTimer !== null) {
      clearInterval(playTimer);
      playTimer = null;
    }
    $play.textContent = on ? "❚❚" : "▶";
    if (on) {
      playTimer = window.setInterval(() => {
        const hasMore = stepOnce();
        if (!hasMore) setPlaying(false);
      }, getSpeed());
    }
  }

  $reset.addEventListener("click", () => {
    setPlaying(false);
    mount();
  });
  $step.addEventListener("click", () => {
    setPlaying(false);
    stepOnce();
  });
  $play.addEventListener("click", () => setPlaying(playTimer === null));

  mount();

  return {
    el,
    destroy(): void {
      setPlaying(false);
      if (view) view.destroy();
    },
  };
}
