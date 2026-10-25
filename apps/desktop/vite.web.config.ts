import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const path = (relative: string) =>
  fileURLToPath(new URL(relative, import.meta.url));
const proxy = {
  "/downloads/windows-latest.json": {
    target: "https://cgplat.zqdesigned.city",
    changeOrigin: true,
  },
  "/api": {
    target: process.env.WEB_API_PROXY ?? "http://127.0.0.1:14310",
    changeOrigin: true,
  },
};

// Both products compile the exact same React entry/components/styles. Only the
// default server differs: web deployments use their own origin behind a proxy.
export default defineConfig({
  root: path("./src/renderer"),
  plugins: [react()],
  define: {
    "import.meta.env.VITE_API_URL": JSON.stringify(
      process.env.WEB_API_URL ?? "",
    ),
    "import.meta.env.VITE_WEB_URL": JSON.stringify(""),
  },
  server: { host: "127.0.0.1", port: 5180, strictPort: true, proxy },
  preview: { host: "127.0.0.1", port: 5180, strictPort: true, proxy },
  build: { outDir: path("../web/dist"), emptyOutDir: true },
});
