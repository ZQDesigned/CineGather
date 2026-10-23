import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/main.ts", "src/admin-cli.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  sourcemap: true,
  clean: true,
  noExternal: [/^@cinegather\//],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
