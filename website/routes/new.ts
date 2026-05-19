// "/new" — full-viewport scratch editor. Content persists to
// localStorage so the page survives reloads / tab close. A slim top
// menu offers back-to-home, source toggle, and clear.

import { createEditor } from "../../src/lib.ts";

const STORAGE_KEY = "typora-web:new:md";

export function newRoute(root: HTMLElement): () => void {
  const main = document.createElement("main");
  main.className = "page page-new";
  main.innerHTML = `
    <header class="new-menu">
      <a class="brand" href="#/">typora-web</a>
      <div class="new-menu-actions">
        <button type="button" data-act="source">Source ⌘/</button>
        <button type="button" data-act="clear">Clear</button>
      </div>
    </header>
    <div class="new-editor"></div>
  `;
  root.append(main);

  const host = main.querySelector(".new-editor") as HTMLElement;
  const initial = localStorage.getItem(STORAGE_KEY) ?? "";
  const editor = createEditor(host, {
    initialContent: initial,
    onChange: (md) => {
      try {
        localStorage.setItem(STORAGE_KEY, md);
      } catch {}
    },
  });

  // Focus the editor when the user clicks anywhere in the editor area
  // outside the contenteditable (the host can be much taller than the
  // current content, especially when the doc is empty).
  const onHostClick = (e: MouseEvent): void => {
    if (e.target === host || e.target === host.firstElementChild) {
      editor.focus();
    }
  };
  host.addEventListener("click", onHostClick);

  const menu = main.querySelector(".new-menu") as HTMLElement;
  const onMenuClick = (e: MouseEvent): void => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "source") editor.toggleSource();
    if (btn.dataset.act === "clear") {
      editor.setMarkdown("");
      localStorage.removeItem(STORAGE_KEY);
      editor.focus();
    }
  };
  menu.addEventListener("click", onMenuClick);

  editor.focus();

  return () => {
    host.removeEventListener("click", onHostClick);
    editor.destroy();
  };
}
