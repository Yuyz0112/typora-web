import type { Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { defaultPlugins } from "./editor.ts";
import { feedEvent, type Event } from "./events.ts";
import { collectCases } from "./features/index.ts";
import { parse } from "./parser.ts";
import { serialize } from "./serializer.ts";
import { schema } from "./schema.ts";
import { pretty } from "./test-pretty.ts";

import "prosemirror-view/style/prosemirror.css";
import "./style.css";

// ─────────────────────────────────────────────────────────────────────────────
// Preset visualisation scripts. Feature scenarios come straight from each
// feature's `cases` array — one data source for both assertions and the
// harness, so they never drift. A handful of core/editor presets (typing,
// cursor, history) are hand-written since they're not tied to any syntax
// feature.
// ─────────────────────────────────────────────────────────────────────────────

type Script = {
  id: string;
  label: string;
  seed: string;
  events: Event[];
};

const featureScripts: Script[] = collectCases().map((c) => ({
  id: `${c.feature}-${c.id}`,
  label: `${c.feature}: ${c.label}`,
  seed: c.seed,
  events: c.events,
}));

const coreScripts: Script[] = [
  { id: "plain-typing", label: "plain: hello world", seed: "", events: ["hello world"] },
  { id: "cursor-move", label: "cursor: type+home+type", seed: "",
    events: ["a", "b", "c", "<Home>", "x", "y"] },
  { id: "backspace", label: "edit: abcd + 2×Backspace", seed: "abcd",
    events: ["<Backspace>", "<Backspace>"] },
  { id: "undo", label: "undo: type+undo", seed: "", events: ["a", "b", "c", "<Mod-z>"] },
];

const SCRIPTS: Script[] = [...featureScripts, ...coreScripts];

// ─────────────────────────────────────────────────────────────────────────────
// DOM layout
// ─────────────────────────────────────────────────────────────────────────────

const root = document.querySelector<HTMLDivElement>("#app")!;
root.innerHTML = `
  <div class="harness">
    <div class="controls">
      <strong>Free editor</strong>
      <button id="free-clear">Clear</button>
      <span class="hint">type anything; pretty / md update live</span>
    </div>
    <div class="pane pane-editor" id="free-editor"></div>
    <div class="free-dumps">
      <details class="dump" open>
        <summary>pretty() snapshot</summary>
        <pre id="free-pretty-dump"></pre>
      </details>
      <details class="dump" open>
        <summary>serialize() (md)</summary>
        <pre id="free-md-dump"></pre>
      </details>
    </div>

    <hr class="section-divider" />
    <div class="case-list-header">
      <strong>Cases</strong>
      <span class="hint">each card is independent — step/play multiple in parallel</span>
      <label class="global-speed">
        speed
        <input id="global-speed" type="range" min="50" max="1500" step="50" value="250" />
        <span id="global-speed-val">250ms</span>
      </label>
    </div>
    <div class="case-list" id="case-list"></div>
  </div>
`;

// ─────────────────────────────────────────────────────────────────────────────
// Per-case card — a self-contained replay harness. One EditorView, its own
// cursorIndex, its own controls. Cards don't coordinate; you can play several
// at once and they tick independently.
// ─────────────────────────────────────────────────────────────────────────────

type Card = {
  el: HTMLElement;
  destroy(): void;
};

function createCard(script: Script, getSpeed: () => number): Card {
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
      <div class="case-dumps">
        <pre class="case-pretty"></pre>
        <pre class="case-md"></pre>
      </div>
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
    // Match test-utils.ts:setup — cursor lands at doc end after seed parse.
    // Otherwise cases like list's 3-step staircase (seed `- a\n  - b`) run
    // the events against the WRONG starting cursor position (end of `a`
    // instead of end of `b`) and produce visibly wrong DOM in the harness.
    const state = EditorState.create({
      schema,
      doc,
      selection: TextSelection.atEnd(doc),
      plugins: defaultPlugins(),
    });
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

// ─────────────────────────────────────────────────────────────────────────────
// Free editor — no script, direct keyboard input; useful for comparing
// real-typing behaviour against scripted replay.
// ─────────────────────────────────────────────────────────────────────────────

const $freeEditor = document.getElementById("free-editor") as HTMLDivElement;
const $freePretty = document.getElementById("free-pretty-dump") as HTMLElement;
const $freeMd = document.getElementById("free-md-dump") as HTMLElement;
const $freeClear = document.getElementById("free-clear") as HTMLButtonElement;

function mountFreeEditor(): EditorView {
  const doc = schema.nodes.doc.createAndFill()!;
  const state = EditorState.create({
    schema,
    doc,
    plugins: defaultPlugins({ cursorWidget: false }),
  });
  const v = new EditorView($freeEditor, {
    state,
    dispatchTransaction(tr) {
      const next = v.state.apply(tr);
      v.updateState(next);
      $freePretty.textContent = pretty(next);
      $freeMd.textContent = serialize(next.doc);
    },
  });
  $freePretty.textContent = pretty(state);
  $freeMd.textContent = serialize(state.doc);
  return v;
}

let freeView = mountFreeEditor();

$freeClear.addEventListener("click", () => {
  freeView.destroy();
  $freeEditor.innerHTML = "";
  freeView = mountFreeEditor();
});

// ─────────────────────────────────────────────────────────────────────────────
// Mount every case as its own card.
// ─────────────────────────────────────────────────────────────────────────────

const $caseList = document.getElementById("case-list") as HTMLDivElement;
const $globalSpeed = document.getElementById("global-speed") as HTMLInputElement;
const $globalSpeedVal = document.getElementById("global-speed-val") as HTMLSpanElement;

const getSpeed = (): number => Number($globalSpeed.value);

$globalSpeed.addEventListener("input", () => {
  $globalSpeedVal.textContent = `${$globalSpeed.value}ms`;
});

for (const s of SCRIPTS) {
  const card = createCard(s, getSpeed);
  $caseList.append(card.el);
}
