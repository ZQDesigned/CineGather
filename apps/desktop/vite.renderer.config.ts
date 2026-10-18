import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  root: resolve("src/renderer"),
  envDir: resolve("../.."),
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
