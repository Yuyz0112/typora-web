import { defineConfig } from "vite-plus";
import { resolve } from "node:path";

// Lib mode build — produces a treeshakeable ESM bundle of the editor
// from src/lib.ts. Specs/tests/website are not on this build's import
// graph, so the output stays lean. PM packages and markdown-it stay
// external (consumers bring their own).

export default defineConfig({
  // No public assets — the lib doesn't ship a favicon.
  publicDir: false,
  build: {
    lib: {
      entry: resolve(__dirname, "src/lib.ts"),
      formats: ["es"],
      fileName: "typora-web",
    },
    outDir: "dist/lib",
    emptyOutDir: true,
    rollupOptions: {
      external: [
        /^prosemirror-/,
        "markdown-it",
        /^markdown-it-/,
      ],
    },
  },
});
