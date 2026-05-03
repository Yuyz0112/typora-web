import type { Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { defaultPlugins } from "./editor.ts";
import { feedEvent, type Event } from "../specs/events.ts";
import { collectCases } from "../specs/features/index.ts";
import { parse } from "./parser.ts";
import { serialize } from "./serializer.ts";
import { schema } from "./schema.ts";
import { pretty } from "../specs/pretty.ts";

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
      <button id="free-source-toggle">Source mode <kbd>⌘/</kbd></button>
      <span class="hint">type anything; pretty / md update live</span>
    </div>
    <div class="pane pane-editor" id="free-editor"></div>
    <textarea id="free-source" class="pane pane-editor source-textarea" hidden></textarea>
    <div class="free-dumps">
      <details class="dump" open>
        <summary>pretty() snapshot <button class="copy-btn" data-copy="free-pretty-dump">copy</button></summary>
        <pre id="free-pretty-dump" class="wrap-pre"></pre>
      </details>
      <details class="dump" open>
        <summary>serialize() (md) <button class="copy-btn" data-copy="free-md-dump">copy</button></summary>
        <pre id="free-md-dump" class="wrap-pre"></pre>
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
        <div class="dump-wrap">
          <button class="copy-btn copy-btn-corner" data-copy-sibling="pretty">copy</button>
          <pre class="case-pretty wrap-pre"></pre>
        </div>
        <div class="dump-wrap">
          <button class="copy-btn copy-btn-corner" data-copy-sibling="md">copy</button>
          <pre class="case-md wrap-pre"></pre>
        </div>
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
// Source mode toggle (free editor only). ⌘/ (or Ctrl+/ on non-Mac) swaps the
// PM editor with a plain textarea showing serialize(doc). Edits in the
// textarea round-trip back into a fresh PM state on toggle off. This is
// the only way to author syntaxes whose live editor surface differs from
// the source (e.g. setext heading: parser-only, no input rule).
// ─────────────────────────────────────────────────────────────────────────────

const $freeSource = document.getElementById("free-source") as HTMLTextAreaElement;
const $freeSourceToggle = document.getElementById("free-source-toggle") as HTMLButtonElement;
let inSourceMode = false;

function enterSourceMode(): void {
  $freeSource.value = serialize(freeView.state.doc);
  $freeEditor.hidden = true;
  $freeSource.hidden = false;
  $freeSource.focus();
  inSourceMode = true;
  $freeSourceToggle.classList.add("active");
}

function exitSourceMode(): void {
  const md = $freeSource.value;
  freeView.destroy();
  $freeEditor.innerHTML = "";
  const doc = md ? parse(md) : schema.nodes.doc.createAndFill()!;
  const state = EditorState.create({
    schema,
    doc,
    plugins: defaultPlugins({ cursorWidget: false }),
  });
  freeView = new EditorView($freeEditor, {
    state,
    dispatchTransaction(tr) {
      const next = freeView.state.apply(tr);
      freeView.updateState(next);
      $freePretty.textContent = pretty(next);
      $freeMd.textContent = serialize(next.doc);
    },
  });
  $freePretty.textContent = pretty(state);
  $freeMd.textContent = serialize(state.doc);
  $freeSource.hidden = true;
  $freeEditor.hidden = false;
  freeView.focus();
  inSourceMode = false;
  $freeSourceToggle.classList.remove("active");
}

function toggleSourceMode(): void {
  if (inSourceMode) exitSourceMode();
  else enterSourceMode();
}

$freeSourceToggle.addEventListener("click", toggleSourceMode);

// Global ⌘/ (Cmd+/ on Mac, Ctrl+/ elsewhere). We use a window-level keydown
// because the textarea isn't a PM view, so PM's keymap doesn't reach it.
window.addEventListener("keydown", (e) => {
  if (e.key !== "/") return;
  const isMac = /Mac/.test(navigator.platform);
  if (!(isMac ? e.metaKey : e.ctrlKey)) return;
  if (e.shiftKey || e.altKey) return;
  // Only fire when focus is inside the free editor / source textarea —
  // otherwise this swallows ⌘/ for the case-card editors too.
  const target = e.target as Element | null;
  if (!target) return;
  const insideFree =
    $freeEditor.contains(target) || target === $freeSource;
  if (!insideFree) return;
  e.preventDefault();
  toggleSourceMode();
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

// Global copy-button handler. Each `.copy-btn` either has `data-copy="<id>"`
// (target by id, used in the free editor) or `data-copy-sibling="pretty"|
// "md"` (find the sibling .case-pretty / .case-md inside the same
// .dump-wrap, used in case cards). Click → copy text to clipboard, briefly
// show "✓".
document.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".copy-btn");
  if (!btn) return;
  e.preventDefault();
  let target: Element | null = null;
  const id = btn.getAttribute("data-copy");
  if (id) target = document.getElementById(id);
  const sib = btn.getAttribute("data-copy-sibling");
  if (sib) {
    const wrap = btn.closest(".dump-wrap");
    target = wrap?.querySelector(sib === "pretty" ? ".case-pretty" : ".case-md") ?? null;
  }
  if (!target) return;
  const text = target.textContent ?? "";
  navigator.clipboard.writeText(text).then(() => {
    const orig = btn.textContent ?? "copy";
    btn.textContent = "✓";
    setTimeout(() => {
      btn.textContent = orig;
    }, 800);
  }).catch(() => {
    // ignore
  });
});
