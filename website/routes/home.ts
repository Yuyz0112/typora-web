// "/" — the Editor route. A single, freely editable PM view preloaded
// with `preset.md`. The preset markdown is itself the marketing copy
// — it explains the project AND demonstrates ~10 syntax features just
// by being rendered.

import { mountNav } from "../components/nav.ts";
import { mountFreeEditor } from "../components/free-editor.ts";
import preset from "../../README.md?raw";

export function homeRoute(root: HTMLElement): () => void {
  mountNav(root, "/");

  const main = document.createElement("main");
  main.className = "page page-home";
  main.innerHTML = `
    <section class="hero-editor"></section>
    <p class="route-footer">
      The text above is editable. <a href="#/specs">Browse specs</a> for
      the full Typora-compatibility catalog.
    </p>
  `;
  root.append(main);

  const host = main.querySelector(".hero-editor") as HTMLElement;
  const editor = mountFreeEditor(host, { initialMd: preset });

  return () => {
    editor.destroy();
  };
}
