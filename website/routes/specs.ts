// "/specs" — the spec catalog route. Every feature is a collapsible
// section; opening a section lazily mounts a case-card per case so
// closing the section can dispose its EditorViews and we don't pay
// for ones the user isn't looking at.
//
// Layout:
//   header           — short tagline + count summary
//   filter input     — free-text match against feature name / case label
//   feature groups   — one per feature; the group summary is the name
//                      + count, with a 1-line description on its own
//                      row when expanded.

import { createCaseCard, type Script, type CaseCard } from "../components/case-card.ts";
import { mountNav } from "../components/nav.ts";
import { collectCases } from "../../specs/features/index.ts";

const ISSUE_URL = "https://github.com/yuyz0112/typora-web/issues/new";

// One-line plain-words descriptions per feature. Anything not in the
// map renders without a description (graceful).
const FEATURE_DESCRIPTIONS: Record<string, string> = {
  emphasis: "Italic and bold via */_ runs.",
  code: "Inline code spans with backtick fences.",
  strike: "Strikethrough via ~~…~~.",
  highlight: "Highlight via ==…== (Typora extension).",
  "sub-sup": "Subscript ~x~ and superscript ^x^ (Typora extension).",
  link: "Inline links [text](url \"title\").",
  autolink: "Autolinks for bare URLs and <…> brackets.",
  image: "Inline images ![alt](src).",
  emoji: "Shortcode emoji like :smile: that resolve to glyphs.",
  "html-comment": "Inline and block HTML comments.",
  heading: "ATX headings #..######, with sticky draft state.",
  blockquote: "> quoted blocks, joined and split by Enter.",
  bullet_list: "Bullet and ordered lists with Typora-style staircase exit.",
  task: "Task-list items: - [ ] / - [x] checkboxes.",
  code_block: "Fenced code blocks with language input.",
  horizontal_rule: "Thematic break lines (---).",
  "front-matter": "YAML front-matter at the top of a doc.",
  "ref-def": "Reference link definitions [id]: url.",
  table: "Pipe tables with alignment row.",
  toc: "Auto-generated table of contents block.",
  auto_pair: "Smart pairing of brackets and quotes around selection.",
};

type Group = {
  feature: string;
  scripts: Script[];
};

function groupByFeature(): Group[] {
  const byFeat = new Map<string, Script[]>();
  for (const c of collectCases()) {
    const arr = byFeat.get(c.feature) ?? [];
    arr.push({
      id: `${c.feature}-${c.id}`,
      label: c.label,
      seed: c.seed,
      events: c.events,
      checkpoints: c.checkpoints,
      feature: c.feature,
    });
    byFeat.set(c.feature, arr);
  }
  return [...byFeat.entries()]
    .map(([feature, scripts]) => ({ feature, scripts }))
    .sort((a, b) => a.feature.localeCompare(b.feature));
}

export function specsRoute(root: HTMLElement): () => void {
  mountNav(root, "/specs");

  const groups = groupByFeature();
  const totalCases = groups.reduce((n, g) => n + g.scripts.length, 0);

  const main = document.createElement("main");
  main.className = "page page-specs";
  main.innerHTML = `
    <header class="specs-header">
      <h1>Spec</h1>
      <p class="specs-meta">A spec is a typed object <code>{ id, label, seed, events[], checkpoints[] }</code> that the test runner replays through a headless EditorView and compares to the expected rendered output at each checkpoint. The spec is the source of truth; the test case is its compiled form. Edits to <code>specs/features/&lt;name&gt;.specs.ts</code> flow straight into the test suite.</p>
      <p class="specs-meta"><strong>${totalCases}</strong> specs across <strong>${groups.length}</strong> features. Each card replays a scripted event stream; checkpoint rows below are colored by whether the simulated output matched at mount time.</p>
      <details class="specs-format">
        <summary>How to write a spec</summary>
        <div class="specs-format-body">
          <p>A spec has four fields. <code>seed</code> is the markdown the editor parses before any events run; pass <code>""</code> for an empty doc. <code>events</code> is the input stream the test feeds, one element at a time:</p>
          <ul>
            <li>a single character like <code>"a"</code> or <code>" "</code> (one keystroke)</li>
            <li>a multi-character string like <code>"hello"</code> (fed char by char)</li>
            <li>a named key in angle brackets: <code>&lt;Enter&gt;</code>, <code>&lt;Backspace&gt;</code>, <code>&lt;Tab&gt;</code>, <code>&lt;ArrowLeft&gt;</code>, <code>&lt;Home&gt;</code>, <code>&lt;End&gt;</code>, <code>&lt;Delete&gt;</code></li>
            <li>a modifier combo: <code>&lt;Mod-z&gt;</code> (Cmd on Mac, Ctrl elsewhere), <code>&lt;Shift-Tab&gt;</code>, <code>&lt;Mod-Shift-Backspace&gt;</code></li>
          </ul>
          <p>Each <code>checkpoint</code> is a <code>{ at, expect }</code> pair. <code>at</code> is the number of events to feed before asserting (so <code>at: 0</code> asserts the post-seed state, <code>at: events.length</code> asserts the final state). <code>expect</code> is the pretty-printed projection of the editor DOM after that step. Pretty tags:</p>
          <table class="specs-format-table">
            <thead><tr><th>Tag</th><th>Meaning</th></tr></thead>
            <tbody>
              <tr><td>plain text</td><td>verbatim</td></tr>
              <tr><td><code>&lt;i&gt;…&lt;/i&gt;</code></td><td>em</td></tr>
              <tr><td><code>&lt;b&gt;…&lt;/b&gt;</code></td><td>strong</td></tr>
              <tr><td><code>&lt;c&gt;…&lt;/c&gt;</code></td><td>inline code</td></tr>
              <tr><td><code>&lt;s&gt;…&lt;/s&gt;</code></td><td>strike</td></tr>
              <tr><td><code>&lt;l:url&gt;…&lt;/l&gt;</code></td><td>link</td></tr>
              <tr><td><code>&lt;a:url&gt;…&lt;/a&gt;</code></td><td>autolink</td></tr>
              <tr><td><code>&lt;mark&gt;…&lt;/mark&gt;</code> · <code>&lt;sub&gt;…&lt;/sub&gt;</code> · <code>&lt;sup&gt;…&lt;/sup&gt;</code></td><td>highlight, sub, sup</td></tr>
              <tr><td><code>&lt;g&gt;*&lt;/g&gt;</code> · <code>&lt;g&gt;**&lt;/g&gt;</code> · <code>&lt;g&gt;\`&lt;/g&gt;</code></td><td>gray source delimiter (cursor inside the surrounding span)</td></tr>
              <tr><td><code>|</code></td><td>empty-selection caret</td></tr>
              <tr><td><code>[…]</code></td><td>non-empty selection range</td></tr>
              <tr><td><code># </code> · <code>## </code></td><td>heading prefix (level by hash count)</td></tr>
              <tr><td><code>- </code> · <code>1. </code></td><td>list item marker</td></tr>
              <tr><td><code>&gt; </code></td><td>blockquote prefix</td></tr>
              <tr><td><code>&lt;hr/&gt;</code> · <code>&lt;br/&gt;</code> · <code>&lt;toc/&gt;</code></td><td>self-closing block markers</td></tr>
              <tr><td><code>&lt;checkbox/&gt;</code> · <code>&lt;checkbox checked/&gt;</code></td><td>task-list checkbox</td></tr>
            </tbody>
          </table>
        </div>
      </details>
      <div class="specs-toolbar">
        <input
          id="specs-filter"
          class="specs-filter"
          type="search"
          placeholder="filter by feature or label…"
          autocomplete="off"
          spellcheck="false"
        />
      </div>
    </header>
    <div class="specs-groups"></div>
    <footer class="specs-footer">
      <span>Behavior wrong or missing?</span>
      <a href="${ISSUE_URL}" target="_blank" rel="noopener">file an issue</a>
      <span>— include the seed, event stream, and observed pretty.</span>
    </footer>
  `;
  root.append(main);

  const $groups = main.querySelector(".specs-groups") as HTMLElement;
  const $filter = main.querySelector("#specs-filter") as HTMLInputElement;

  const allCards: CaseCard[] = [];

  type GroupHandle = {
    feature: string;
    detail: HTMLDetailsElement;
    scripts: Script[];
    cardEls: HTMLElement[];
    mountCards: () => void;
  };
  const handles: GroupHandle[] = [];

  for (const [i, g] of groups.entries()) {
    const det = document.createElement("details") as HTMLDetailsElement;
    det.className = "spec-group";
    if (i === 0) det.open = true;
    const desc = FEATURE_DESCRIPTIONS[g.feature] ?? "";
    det.innerHTML = `
      <summary>
        <span class="spec-group-name"></span>
        <span class="spec-group-count">${g.scripts.length}</span>
      </summary>
      ${desc ? `<p class="spec-group-desc"></p>` : ""}
      <div class="spec-group-body"></div>
    `;
    (det.querySelector(".spec-group-name") as HTMLElement).textContent = g.feature;
    if (desc) {
      (det.querySelector(".spec-group-desc") as HTMLElement).textContent = desc;
    }
    const body = det.querySelector(".spec-group-body") as HTMLElement;
    let mountedCards: CaseCard[] | null = null;
    const cardEls: HTMLElement[] = [];

    const mountCards = (): void => {
      if (mountedCards) return;
      mountedCards = g.scripts.map((s) => {
        const c = createCaseCard(s);
        c.el.dataset.featureId = g.feature;
        c.el.dataset.caseLabel = s.label.toLowerCase();
        body.append(c.el);
        cardEls.push(c.el);
        return c;
      });
      allCards.push(...mountedCards);
      applyFilter($filter.value);
    };
    const unmountCards = (): void => {
      if (!mountedCards) return;
      for (const c of mountedCards) c.destroy();
      body.innerHTML = "";
      cardEls.length = 0;
      mountedCards = null;
    };

    if (det.open) mountCards();
    det.addEventListener("toggle", () => {
      if (det.open) mountCards();
      else unmountCards();
    });
    $groups.append(det);

    handles.push({
      feature: g.feature,
      detail: det,
      scripts: g.scripts,
      cardEls,
      mountCards,
    });
  }

  function applyFilter(q: string): void {
    const needle = q.trim().toLowerCase();
    if (!needle) {
      for (const h of handles) {
        h.detail.classList.remove("hidden");
        for (const el of h.cardEls) el.classList.remove("hidden");
      }
      return;
    }
    for (const h of handles) {
      const featHit = h.feature.toLowerCase().includes(needle);
      const matchedScripts = h.scripts.filter(
        (s) => featHit || s.label.toLowerCase().includes(needle),
      );
      if (matchedScripts.length === 0) {
        h.detail.classList.add("hidden");
        continue;
      }
      h.detail.classList.remove("hidden");
      if (!h.detail.open) {
        h.detail.open = true;
      } else {
        h.mountCards();
      }
      for (const el of h.cardEls) {
        const lbl = el.dataset.caseLabel ?? "";
        const show = featHit || lbl.includes(needle);
        el.classList.toggle("hidden", !show);
      }
    }
  }

  let filterTimer: number | null = null;
  $filter.addEventListener("input", () => {
    if (filterTimer !== null) clearTimeout(filterTimer);
    filterTimer = window.setTimeout(() => applyFilter($filter.value), 80);
  });

  return () => {
    if (filterTimer !== null) clearTimeout(filterTimer);
    for (const c of allCards) c.destroy();
  };
}
