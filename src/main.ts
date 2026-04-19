import type { Node as PMNode } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
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
// cursor, history) are hand-written below since they're not tied to any
// syntax feature.
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
      <label>preset
        <select id="script"></select>
      </label>
      <button id="reset">Reset</button>
      <button id="step">Step ▸</button>
      <button id="play">Play ▶</button>
      <label>speed
        <input id="speed" type="range" min="100" max="1500" step="100" value="500" />
        <span id="speed-val">500ms</span>
      </label>
    </div>
    <div class="meta">
      <div class="progress"><span id="progress"></span></div>
      <div class="next">next: <code id="next-event">—</code></div>
    </div>
    <div class="pane pane-editor" id="editor"></div>
    <details class="dump" open>
      <summary>pretty() snapshot</summary>
      <pre id="pretty-dump"></pre>
    </details>
    <details class="dump" open>
      <summary>serialize() (md)</summary>
      <pre id="md-dump"></pre>
    </details>

    <hr class="section-divider" />
    <div class="controls">
      <strong>Free editor</strong>
      <button id="free-clear">Clear</button>
      <span class="hint">type anything; pretty / md update live</span>
    </div>
    <div class="pane pane-editor" id="free-editor"></div>
    <details class="dump" open>
      <summary>pretty() snapshot</summary>
      <pre id="free-pretty-dump"></pre>
    </details>
    <details class="dump" open>
      <summary>serialize() (md)</summary>
      <pre id="free-md-dump"></pre>
    </details>
  </div>
`;

const $script = document.getElementById("script") as HTMLSelectElement;
const $reset = document.getElementById("reset") as HTMLButtonElement;
const $step = document.getElementById("step") as HTMLButtonElement;
const $play = document.getElementById("play") as HTMLButtonElement;
const $speed = document.getElementById("speed") as HTMLInputElement;
const $speedVal = document.getElementById("speed-val") as HTMLSpanElement;
const $progress = document.getElementById("progress") as HTMLSpanElement;
const $nextEvent = document.getElementById("next-event") as HTMLElement;
const $editor = document.getElementById("editor") as HTMLDivElement;
const $prettyDump = document.getElementById("pretty-dump") as HTMLElement;
const $mdDump = document.getElementById("md-dump") as HTMLElement;

for (const s of SCRIPTS) {
  const opt = document.createElement("option");
  opt.value = s.id;
  opt.textContent = s.label;
  $script.append(opt);
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor lifecycle
// ─────────────────────────────────────────────────────────────────────────────

let view: EditorView | null = null;
let currentScript: Script = SCRIPTS[0]!;
let cursorIndex = 0; // index of the next event to dispatch
let playTimer: number | null = null;

function mountFromScript(script: Script): void {
  const doc: PMNode = script.seed ? parse(script.seed) : schema.nodes.doc.createAndFill()!;
  const state = EditorState.create({ schema, doc, plugins: defaultPlugins() });
  if (view) view.destroy();
  view = new EditorView($editor, { state });
  cursorIndex = 0;
  redraw();
}

function redraw(): void {
  if (!view) return;
  const done = cursorIndex >= currentScript.events.length;
  $progress.textContent = `${cursorIndex} / ${currentScript.events.length}`;
  $nextEvent.textContent = done ? "(end)" : currentScript.events[cursorIndex]!;
  $prettyDump.textContent = pretty(view.state);
  $mdDump.textContent = serialize(view.state.doc);
  $step.disabled = done;
  $play.disabled = done;
}

function stepOnce(): boolean {
  if (!view) return false;
  if (cursorIndex >= currentScript.events.length) return false;
  const e = currentScript.events[cursorIndex]!;
  feedEvent(view, e);
  cursorIndex++;
  redraw();
  return cursorIndex < currentScript.events.length;
}

function setPlaying(on: boolean): void {
  if (playTimer !== null) {
    clearInterval(playTimer);
    playTimer = null;
  }
  $play.textContent = on ? "Pause ❚❚" : "Play ▶";
  if (on) {
    const speed = Number($speed.value);
    playTimer = window.setInterval(() => {
      const hasMore = stepOnce();
      if (!hasMore) setPlaying(false);
    }, speed);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Control wiring
// ─────────────────────────────────────────────────────────────────────────────

$script.addEventListener("change", () => {
  setPlaying(false);
  currentScript = SCRIPTS.find((s) => s.id === $script.value) ?? SCRIPTS[0]!;
  mountFromScript(currentScript);
});
$reset.addEventListener("click", () => {
  setPlaying(false);
  mountFromScript(currentScript);
});
$step.addEventListener("click", () => {
  setPlaying(false);
  stepOnce();
});
$play.addEventListener("click", () => {
  setPlaying(playTimer === null);
});
$speed.addEventListener("input", () => {
  $speedVal.textContent = `${$speed.value}ms`;
  if (playTimer !== null) {
    setPlaying(false);
    setPlaying(true);
  }
});

// Initial mount
mountFromScript(currentScript);

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
