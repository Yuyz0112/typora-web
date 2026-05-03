// "/specs" — the spec catalog route. Every feature is a collapsible
// section; opening a section lazily mounts a case-card per case so
// closing the section can dispose its EditorViews and we don't pay
// for ones the user isn't looking at.
//
// Layout:
//   header           — count summary + global play-speed slider
//   filter input     — free-text match against feature name / case label
//   feature groups   — sorted by feature name. Each group has a 1-line
//                      description and is collapsed by default (first
//                      open) so the page reads as a TOC.

import { createCaseCard, type Script, type CaseCard } from "../components/case-card.ts";
import { mountNav } from "../components/nav.ts";
import { collectCases } from "../../specs/features/index.ts";

const GLOBAL_SPEED_DEFAULT = 250;
const ISSUE_URL = "https://github.com/anthropics/typora-web/issues/new";

// One-line plain-words descriptions per feature. The map key matches
// the `name` field on each FeatureSpecs. Anything not in the map falls
// back to the empty string (no row shown). Keep these short — the goal
// is "what does this DO", not docs.
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
      <h1>Spec catalog</h1>
      <p class="specs-meta">
        <strong>${totalCases}</strong> behaviors across
        <strong>${groups.length}</strong> features. Each card replays a
        scripted event stream; step or scrub to a checkpoint to see the
        exact shape we test for.
      </p>
      <div class="specs-toolbar">
        <input
          id="specs-filter"
          class="specs-filter"
          type="search"
          placeholder="filter by feature or label…"
          autocomplete="off"
          spellcheck="false"
        />
        <label class="global-speed">
          <span>play</span>
          <input id="global-speed" type="range" min="50" max="1500"
                 step="50" value="${GLOBAL_SPEED_DEFAULT}" />
          <span id="global-speed-val">${GLOBAL_SPEED_DEFAULT}ms</span>
        </label>
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
  const $globalSpeed = main.querySelector("#global-speed") as HTMLInputElement;
  const $globalSpeedVal = main.querySelector(
    "#global-speed-val",
  ) as HTMLSpanElement;
  const getSpeed = (): number => Number($globalSpeed.value);

  $globalSpeed.addEventListener("input", () => {
    $globalSpeedVal.textContent = `${$globalSpeed.value}ms`;
  });

  // Each group renders its cards lazily, on first <details> open. Closing
  // the section destroys the cards so EditorViews + their plugins (and
  // toolbars, listeners, etc.) don't accumulate.
  const allCards: CaseCard[] = [];

  type GroupHandle = {
    feature: string;
    detail: HTMLDetailsElement;
    scripts: Script[];
    cardEls: HTMLElement[]; // empty until mounted
    mountCards: () => void;
  };
  const handles: GroupHandle[] = [];

  for (const [i, g] of groups.entries()) {
    const det = document.createElement("details") as HTMLDetailsElement;
    det.className = "spec-group";
    if (i === 0) det.open = true; // expand the first group; rest collapsed
    const desc = FEATURE_DESCRIPTIONS[g.feature] ?? "";
    det.innerHTML = `
      <summary>
        <span class="spec-group-name"></span>
        <span class="spec-group-count">${g.scripts.length}</span>
        ${desc ? `<span class="spec-group-desc"></span>` : ""}
      </summary>
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
        const c = createCaseCard(s, getSpeed);
        c.el.dataset.featureId = g.feature;
        c.el.dataset.caseLabel = s.label.toLowerCase();
        body.append(c.el);
        cardEls.push(c.el);
        return c;
      });
      allCards.push(...mountedCards);
      // Re-apply current filter on freshly mounted cards.
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

  // Filter: free-text, matches feature name + case label (case-insensitive,
  // whitespace-tolerant). When the query is non-empty we eagerly mount any
  // group that has a matching script so users see results without an extra
  // click. Empty query = restore default (collapsed-except-first) shape.
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
      // Expand + mount so matches are visible.
      if (!h.detail.open) {
        h.detail.open = true; // triggers toggle → mountCards
      } else {
        h.mountCards();
      }
      // Hide non-matching cards within the group (only when feature itself didn't match).
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
