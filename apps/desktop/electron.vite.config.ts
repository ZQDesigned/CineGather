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
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    root: resolve("src/renderer"),
    envDir: resolve("../.."),
    plugins: [react()],
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
    build: { rollupOptions: { input: resolve("src/renderer/index.html") } },
  },
});
