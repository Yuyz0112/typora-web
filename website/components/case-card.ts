// Per-case card — a self-contained replay harness with one EditorView,
// step / play / reset controls, live pretty (always visible), an
// optional collapsible md dump, and a color-coded checkpoint panel.
//
// Checkpoint panel UX:
//   - On mount we run a headless simulation of the script in a
//     fakeView (no DOM). At each checkpoint's `at`, we capture
//     pretty(state) and compare to cp.expect, recording pass/fail.
//   - Each cp row is colored: green when the simulated pretty
//     matched, red when it diverged. The currently-active row (when
//     the live view's cursorIndex equals cp.at) gets a stronger
//     emphasis.
//   - Rows are clickable: click resets and fast-forwards to that step
//     so the user can SEE the (mis)match in the live editor.
//
// The card also exposes a "report" link that prefills a GitHub issue
// with the seed / events / final expected / observed pretty.

import type { Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { defaultPlugins } from "../../src/editor.ts";
import { parse } from "../../src/parser.ts";
import { schema } from "../../src/schema.ts";
import { feedEvent, type Event } from "../../specs/events.ts";
import { pretty } from "../../specs/pretty.ts";
import { fakeView } from "../../specs/sim.ts";

export type Checkpoint = { at: number; expect: string };

export type Script = {
  id: string;
  label: string;
  seed: string;
  events: Event[];
  checkpoints?: Checkpoint[];
  feature?: string;
};

export type CaseCard = {
  el: HTMLElement;
  destroy(): void;
};

const ISSUE_URL = "https://github.com/yuyz0112/typora-web/issues/new";
const PLAY_INTERVAL_MS = 250;

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;"
      : c === "<" ? "&lt;"
      : c === ">" ? "&gt;"
      : c === '"' ? "&quot;"
      : "&#39;",
  );
}

function previewSeed(seed: string): string {
  if (!seed) return "(empty)";
  const oneLine = seed.replace(/\n/g, "↵");
  return oneLine.length > 56 ? oneLine.slice(0, 53) + "…" : oneLine;
}

// Render `<code>` spans inside a case label. The labels are author-
// written strings (not user input) so escaping is mostly cosmetic — but
// HTML-escape everything else just to be safe.
function renderLabelHTML(text: string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i) {
        parts.push(`<code>${escapeHTML(text.slice(i + 1, end))}</code>`);
        i = end + 1;
        continue;
      }
    }
    parts.push(escapeHTML(text[i]!));
    i++;
  }
  return parts.join("");
}

// Build the initial EditorState for a given script. Same recipe used
// by both the live mount and the headless simulation, so the two
// agree on starting selection + initial normalize pass.
function initialState(script: Script): EditorState {
  const doc: PMNode = script.seed
    ? parse(script.seed)
    : schema.nodes.doc.createAndFill()!;
  const base = EditorState.create({
    schema,
    doc,
    selection: TextSelection.atEnd(doc),
    plugins: defaultPlugins(),
  });
  // Fire one no-op transaction to trigger normalize (method-B marks
  // need an apply; the bare create() doesn't run appendTransaction).
  return base.apply(base.tr.setSelection(base.selection));
}

// Headless replay: produce a Map<at, ok> where `ok` is whether the
// simulated pretty(state) at step `at` equals the checkpoint's
// expect. Runs once at mount; cheap because cases are short.
function simulateCheckpoints(script: Script): Map<number, boolean> {
  const out = new Map<number, boolean>();
  const cps = script.checkpoints;
  if (!cps || cps.length === 0) return out;
  const view = fakeView(initialState(script));
  const sorted = [...cps].sort((a, b) => a.at - b.at);
  let i = 0;
  for (const cp of sorted) {
    while (i < cp.at) {
      feedEvent(view, script.events[i]!);
      i++;
    }
    out.set(cp.at, pretty(view.state) === cp.expect);
  }
  return out;
}

export function createCaseCard(script: Script): CaseCard {
  const checkpoints = script.checkpoints ?? [];
  const lastCp = checkpoints[checkpoints.length - 1];
  const cpResults = simulateCheckpoints(script);
  const anyMismatch = [...cpResults.values()].some((ok) => !ok);

  const el = document.createElement("div");
  el.className = "case-card";
  if (anyMismatch) el.classList.add("has-mismatch");
  el.innerHTML = `
    <div class="case-head">
      <div class="case-title">
        <span class="case-label"></span>
        <span class="case-meta">
          <span class="case-seed" title="seed"></span>
          <span class="case-evcount" title="events"></span>
        </span>
      </div>
      <div class="case-controls">
        <span class="case-progress"></span>
        <code class="case-next"></code>
        <button data-act="reset" title="Reset">↺</button>
        <button data-act="step" title="Step">▸</button>
        <button data-act="play" title="Play">▶</button>
      </div>
    </div>
    <div class="case-body">
      <div class="case-editor"></div>
      <div class="dump-wrap case-pretty-wrap">
        <button class="copy-btn copy-btn-corner" data-copy="pretty">copy</button>
        <pre class="case-pretty wrap-pre"></pre>
      </div>
      ${checkpoints.length
        ? `<details class="case-checkpoints"${anyMismatch ? " open" : ""}>
            <summary>
              <span class="cp-summary-label">checkpoints</span>
              <span class="cp-summary-stat"></span>
            </summary>
            <ol class="cp-list"></ol>
          </details>`
        : ""}
      <div class="case-report-row">
        <a class="case-issue" target="_blank" rel="noopener">report</a>
      </div>
    </div>
  `;
  (el.querySelector(".case-label") as HTMLElement).innerHTML =
    renderLabelHTML(script.label);
  const $seed = el.querySelector(".case-seed") as HTMLElement;
  $seed.textContent = previewSeed(script.seed);
  if (!script.seed) $seed.classList.add("is-empty");
  (el.querySelector(".case-evcount") as HTMLElement).textContent =
    `${script.events.length} ev`;

  const $editor = el.querySelector(".case-editor") as HTMLDivElement;
  const $pretty = el.querySelector(".case-pretty") as HTMLElement;
  const $progress = el.querySelector(".case-progress") as HTMLElement;
  const $next = el.querySelector(".case-next") as HTMLElement;
  const $reset = el.querySelector('[data-act="reset"]') as HTMLButtonElement;
  const $step = el.querySelector('[data-act="step"]') as HTMLButtonElement;
  const $play = el.querySelector('[data-act="play"]') as HTMLButtonElement;
  const $issue = el.querySelector(".case-issue") as HTMLAnchorElement;
  const $cpList = el.querySelector(".cp-list") as HTMLOListElement | null;
  const $cpStat = el.querySelector(".cp-summary-stat") as HTMLElement | null;

  if ($cpList) {
    $cpList.innerHTML = checkpoints
      .map((c) => {
        const ok = cpResults.get(c.at) ?? true;
        return `<li data-at="${c.at}" class="${ok ? "ok" : "bad"}">
          <span class="cp-at">@${c.at}</span>
          <code class="cp-expect">${escapeHTML(c.expect)}</code>
        </li>`;
      })
      .join("");
  }
  if ($cpStat && checkpoints.length) {
    const passing = [...cpResults.values()].filter((ok) => ok).length;
    $cpStat.textContent = `${passing}/${checkpoints.length}`;
    $cpStat.classList.toggle("all-ok", passing === checkpoints.length);
    $cpStat.classList.toggle("any-bad", passing < checkpoints.length);
  }

  let view: EditorView | null = null;
  let cursorIndex = 0;
  let playTimer: number | null = null;

  function buildIssueHref(observedPretty: string): string {
    const cp = lastCp;
    const title = `[spec] ${script.feature ?? ""} / ${script.label}`.trim();
    const body = [
      `**Spec id:** \`${script.id}\``,
      script.feature ? `**Feature:** \`${script.feature}\`` : "",
      "",
      "**Seed:**",
      "```md",
      script.seed || "(empty)",
      "```",
      "",
      "**Events:**",
      "```ts",
      JSON.stringify(script.events),
      "```",
      "",
      cp ? `**Expected pretty (final checkpoint @${cp.at}):**` : "",
      cp ? "```\n" + cp.expect + "\n```" : "",
      "",
      "**Observed pretty:**",
      "```",
      observedPretty,
      "```",
      "",
      "**What's wrong:**",
      "<!-- describe the divergence -->",
    ]
      .filter((s) => s !== "")
      .join("\n");
    const u = new URL(ISSUE_URL);
    u.searchParams.set("title", title);
    u.searchParams.set("body", body);
    return u.toString();
  }

  function mount(): void {
    if (view) view.destroy();
    view = new EditorView($editor, { state: initialState(script) });
    cursorIndex = 0;
    redraw();
  }

  function redraw(): void {
    if (!view) return;
    const done = cursorIndex >= script.events.length;
    $progress.textContent = `${cursorIndex}/${script.events.length}`;
    $next.textContent = done ? "—" : String(script.events[cursorIndex]!);
    const observed = pretty(view.state);
    $pretty.textContent = observed;
    $step.disabled = done;
    $play.disabled = done;
    el.classList.toggle("done", done);

    if ($cpList) {
      for (const li of $cpList.querySelectorAll<HTMLLIElement>("li")) {
        const at = Number(li.dataset.at);
        li.classList.toggle("active", at === cursorIndex);
      }
    }

    $issue.href = buildIssueHref(observed);
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
      }, PLAY_INTERVAL_MS);
    }
  }

  $reset.addEventListener("click", () => { setPlaying(false); mount(); });
  $step.addEventListener("click", () => { setPlaying(false); stepOnce(); });
  $play.addEventListener("click", () => setPlaying(playTimer === null));

  // Click a checkpoint row to fast-forward to that point.
  if ($cpList) {
    $cpList.addEventListener("click", (e) => {
      const li = (e.target as HTMLElement).closest("li[data-at]") as HTMLLIElement | null;
      if (!li) return;
      const target = Number(li.dataset.at);
      setPlaying(false);
      mount();
      while (cursorIndex < target) {
        if (!stepOnce()) break;
      }
    });
  }

  // Copy buttons (scoped per card).
  el.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".copy-btn");
    if (!btn) return;
    const which = btn.dataset.copy;
    const text = which === "pretty" ? $pretty.textContent ?? "" : "";
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => {
        const orig = btn.textContent;
        btn.textContent = "copied";
        setTimeout(() => { btn.textContent = orig; }, 900);
      },
      () => {},
    );
  });

  mount();

  return {
    el,
    destroy(): void {
      setPlaying(false);
      if (view) view.destroy();
    },
  };
}
