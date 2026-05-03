// "/specs" — the spec catalog route. Every feature is a collapsible
// section; opening a section lazily mounts a case-card per case so
// closing the section can dispose its EditorViews and we don't pay
// for ones the user isn't looking at.
//
// Layout:
//   header          — count summary + report-issue link
//   filter chips    — "all / inline / block / typora extensions"
//                     (basic; a free-text search can be added later)
//   feature groups  — sorted by feature name. Default-collapsed except
//                     for the first group, which expands so the page
//                     isn't a wall of <details>.

import { createCaseCard, type Script, type CaseCard } from "../components/case-card.ts";
import { mountNav } from "../components/nav.ts";
import { collectCases } from "../../specs/features/index.ts";

const GLOBAL_SPEED_DEFAULT = 250;

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
        ${totalCases} specs across ${groups.length} features.
        Each card replays a scripted input sequence; pause / step / reset
        as needed.
      </p>
      <p class="specs-meta">
        Bug or feature gap? File an issue using the same shape — seed,
        events, expected pretty output.
      </p>
      <div class="specs-controls">
        <label class="global-speed">
          play speed
          <input id="global-speed" type="range" min="50" max="1500"
                 step="50" value="${GLOBAL_SPEED_DEFAULT}" />
          <span id="global-speed-val">${GLOBAL_SPEED_DEFAULT}ms</span>
        </label>
      </div>
    </header>
    <div class="specs-groups"></div>
  `;
  root.append(main);

  const $groups = main.querySelector(".specs-groups") as HTMLElement;
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

  for (const [i, g] of groups.entries()) {
    const det = document.createElement("details");
    det.className = "spec-group";
    if (i === 0) det.open = true; // expand the first group; rest collapsed
    det.innerHTML = `
      <summary>
        <span class="spec-group-name">${g.feature}</span>
        <span class="spec-group-count">${g.scripts.length}</span>
      </summary>
      <div class="spec-group-body"></div>
    `;
    const body = det.querySelector(".spec-group-body") as HTMLElement;
    let mountedCards: CaseCard[] | null = null;

    const mountCards = (): void => {
      if (mountedCards) return;
      mountedCards = g.scripts.map((s) => {
        const c = createCaseCard(s, getSpeed);
        body.append(c.el);
        return c;
      });
      allCards.push(...mountedCards);
    };
    const unmountCards = (): void => {
      if (!mountedCards) return;
      for (const c of mountedCards) c.destroy();
      body.innerHTML = "";
      mountedCards = null;
    };

    if (det.open) mountCards();
    det.addEventListener("toggle", () => {
      if (det.open) mountCards();
      else unmountCards();
    });
    $groups.append(det);
  }

  return () => {
    for (const c of allCards) c.destroy();
  };
}
