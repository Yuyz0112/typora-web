// Per-case card — a self-contained replay harness with one EditorView,
// step / play / reset controls, and live pretty + md dumps.
//
// Each card owns its own ticker; cards don't coordinate. The shared
// `getSpeed` getter lets a global slider influence every card's play
// rate without a re-mount.
//
// If the script carries `checkpoints`, the card also surfaces:
//   - a meta line (seed preview + event count badge)
//   - a toggleable "checkpoints" panel listing every (at, expect) row
//   - a live ✓/✗ matches-spec indicator that compares the current
//     pretty() output against the nearest applicable checkpoint
//   - a "report issue" affordance that prefills a GitHub issue body
//     with the seed / event stream / observed pretty / expected pretty.

import type { Node as PMNode } from "prosemirror-model";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { defaultPlugins } from "../../src/editor.ts";
import { parse } from "../../src/parser.ts";
import { schema } from "../../src/schema.ts";
import { serialize } from "../../src/serializer.ts";
import { feedEvent, type Event } from "../../specs/events.ts";
import { pretty } from "../../specs/pretty.ts";

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

const ISSUE_URL = "https://github.com/anthropics/typora-web/issues/new";

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

export function createCaseCard(
  script: Script,
  getSpeed: () => number,
): CaseCard {
  const checkpoints = script.checkpoints ?? [];
  const lastCp = checkpoints[checkpoints.length - 1];

  const el = document.createElement("div");
  el.className = "case-card";
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
        <span class="case-match" title="matches nearest checkpoint"></span>
        <span class="case-progress"></span>
        <code class="case-next"></code>
        <button data-act="reset" title="Reset">↺</button>
        <button data-act="step" title="Step">▸</button>
        <button data-act="play" title="Play">▶</button>
      </div>
    </div>
    <div class="case-body">
      <div class="case-editor"></div>
      <div class="case-foot">
        <details class="case-dumps">
          <summary>pretty + md</summary>
          <div class="dump-wrap">
            <button class="copy-btn copy-btn-corner" data-copy="pretty">copy</button>
            <pre class="case-pretty wrap-pre"></pre>
          </div>
          <div class="dump-wrap">
            <button class="copy-btn copy-btn-corner" data-copy="md">copy</button>
            <pre class="case-md wrap-pre"></pre>
          </div>
        </details>
        ${checkpoints.length
          ? `<details class="case-checkpoints">
              <summary>checkpoints <span class="cp-count">${checkpoints.length}</span></summary>
              <ol class="cp-list"></ol>
            </details>`
          : ""}
        <a class="case-issue" target="_blank" rel="noopener">report</a>
      </div>
    </div>
  `;
  (el.querySelector(".case-label") as HTMLElement).textContent = script.label;
  const $seed = el.querySelector(".case-seed") as HTMLElement;
  $seed.textContent = previewSeed(script.seed);
  if (!script.seed) $seed.classList.add("is-empty");
  (el.querySelector(".case-evcount") as HTMLElement).textContent =
    `${script.events.length} ev`;

  const $editor = el.querySelector(".case-editor") as HTMLDivElement;
  const $pretty = el.querySelector(".case-pretty") as HTMLElement;
  const $md = el.querySelector(".case-md") as HTMLElement;
  const $progress = el.querySelector(".case-progress") as HTMLElement;
  const $next = el.querySelector(".case-next") as HTMLElement;
  const $match = el.querySelector(".case-match") as HTMLElement;
  const $reset = el.querySelector('[data-act="reset"]') as HTMLButtonElement;
  const $step = el.querySelector('[data-act="step"]') as HTMLButtonElement;
  const $play = el.querySelector('[data-act="play"]') as HTMLButtonElement;
  const $issue = el.querySelector(".case-issue") as HTMLAnchorElement;
  const $cpList = el.querySelector(".cp-list") as HTMLOListElement | null;

  if ($cpList) {
    $cpList.innerHTML = checkpoints
      .map(
        (c) =>
          `<li data-at="${c.at}"><span class="cp-at">@${c.at}</span><code class="cp-expect">${escapeHTML(c.expect)}</code></li>`,
      )
      .join("");
  }

  let view: EditorView | null = null;
  let cursorIndex = 0;
  let playTimer: number | null = null;

  function activeCheckpoint(): Checkpoint | undefined {
    // Only the checkpoint that lands EXACTLY on the current cursor is
    // a fair comparison — between checkpoints, we have no expected
    // value to compare against, so the indicator stays neutral.
    return checkpoints.find((c) => c.at === cursorIndex);
  }

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
    const observed = pretty(view.state);
    $pretty.textContent = observed;
    $md.textContent = serialize(view.state.doc);
    $step.disabled = done;
    $play.disabled = done;
    el.classList.toggle("done", done);

    // Live spec match: shown only on the steps that have a checkpoint
    // pinned to them. Between checkpoints we don't know what the
    // expected pretty would be, so the indicator stays empty.
    const cp = activeCheckpoint();
    if (cp) {
      const ok = observed === cp.expect;
      $match.textContent = ok ? "✓" : "✗";
      $match.title = ok
        ? `matches checkpoint @${cp.at}`
        : `expected @${cp.at}: ${cp.expect}`;
      $match.classList.toggle("ok", ok);
      $match.classList.toggle("bad", !ok);
    } else {
      $match.textContent = "";
      $match.classList.remove("ok", "bad");
    }

    // Highlight the current row in the checkpoints panel.
    if ($cpList) {
      for (const li of $cpList.querySelectorAll<HTMLLIElement>("li")) {
        const at = Number(li.dataset.at);
        li.classList.toggle("is-current", cp ? at === cp.at : false);
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
    const text =
      which === "pretty" ? $pretty.textContent ?? ""
      : which === "md" ? $md.textContent ?? ""
      : "";
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
