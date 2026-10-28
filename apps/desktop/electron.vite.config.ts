import { noiseSuppressionAudioWorkletVitePlugin } from "@workadventure/noise-suppression/vite";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ["electron"],
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ["electron"],
        input: {
          index: resolve("src/preload/index.ts"),
          "viewing-window": resolve("src/preload/viewing-window.ts"),
          "member-overlay": resolve("src/preload/member-overlay.ts"),
          "notification-card": resolve("src/preload/notification-card.ts"),
        },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve("src/renderer"),
    envDir: resolve("../.."),
    plugins: [react(), noiseSuppressionAudioWorkletVitePlugin()],
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/renderer/index.html"),
          watch: resolve("src/renderer/watch.html"),
        },
      },
    },
  },
});
