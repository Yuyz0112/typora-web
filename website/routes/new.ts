// "/new" — full-viewport scratch editor. Content persists to
// localStorage so the page survives reloads / tab close. No nav, no
// chrome; the editor owns the entire viewport.

import { createEditor } from "../../src/lib.ts";

const STORAGE_KEY = "typora-web:new:md";

export function newRoute(root: HTMLElement): () => void {
  const main = document.createElement("main");
  main.className = "page page-new";
  root.append(main);

  const initial = localStorage.getItem(STORAGE_KEY) ?? "";
  const editor = createEditor(main, {
    initialContent: initial,
    onChange: (md) => {
      try {
        localStorage.setItem(STORAGE_KEY, md);
      } catch {}
    },
  });

  return () => {
    editor.destroy();
  };
}
