import { defineConfig } from "vite-plus";

export default defineConfig(({ command }) => ({
  // The website (harness UI + specs panel) lives under website/. Vite's
  // dev server / build use it as the doc root so index.html resolves
  // correctly. Lib mode (built separately, see src/lib.ts) does NOT
  // share this root — it bundles src/ only.
  root: "website",
  // GitHub Pages serves the site from a subpath (`/typora-web/`); only
  // the production build needs this — dev still serves from `/`.
  base: command === "build" ? "/typora-web/" : "/",
  build: {
    outDir: "../dist/website",
    emptyOutDir: true,
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  test: {
    // Tests live in tests/ and reference src/ + specs/ directly; pick
    // the project root, not the website root, so vitest discovers them.
    root: ".",
    environment: "happy-dom",
  },
}));
