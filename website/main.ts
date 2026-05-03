// Website bootstrap. Two routes (/, /specs) wired through a tiny hash
// router. Everything else lives in components/ and routes/.

import "prosemirror-view/style/prosemirror.css";
import "../src/styles/widgets.css";
import "../src/styles/theme-typora.css";
import "./style.css";

import { startRouter } from "./router.ts";
import { homeRoute } from "./routes/home.ts";
import { specsRoute } from "./routes/specs.ts";

const root = document.querySelector<HTMLDivElement>("#app")!;

// Global copy-button handler — case cards include `.copy-btn` elements
// with `data-copy-sibling="pretty"|"md"`. Single delegated listener.
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
    target =
      wrap?.querySelector(sib === "pretty" ? ".case-pretty" : ".case-md") ??
      null;
  }
  if (!target) return;
  const text = target.textContent ?? "";
  navigator.clipboard
    .writeText(text)
    .then(() => {
      const orig = btn.textContent ?? "copy";
      btn.textContent = "✓";
      setTimeout(() => {
        btn.textContent = orig;
      }, 800);
    })
    .catch(() => {});
});

startRouter(root, [
  { path: "/", handler: homeRoute },
  { path: "/specs", handler: specsRoute },
]);
