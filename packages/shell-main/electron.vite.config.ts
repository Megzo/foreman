import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const rendererRoot = resolve(import.meta.dirname, "../shell-renderer");

export default defineConfig({
  main: {
    // Workspace packages ship TS sources, so bundle them instead of externalizing.
    plugins: [externalizeDepsPlugin({ exclude: ["@foreman/codex-adapter"] })],
    build: {
      lib: { entry: "src/main.ts" },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: "src/preload.ts" },
    },
  },
  renderer: {
    root: rendererRoot,
    plugins: [react()],
    build: {
      rollupOptions: { input: resolve(rendererRoot, "index.html") },
      outDir: resolve(import.meta.dirname, "out/renderer"),
    },
  },
});
