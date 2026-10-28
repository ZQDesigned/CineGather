import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig } from "@playwright/test";
if (existsSync(".env")) loadEnvFile(".env");
export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "browser-web.spec.ts",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1440, height: 1000 },
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--mute-audio",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--auto-select-desktop-capture-source=Entire screen",
        "--enable-usermedia-screen-capturing",
      ],
    },
  },
  webServer: [
    {
      command: "bun run dev:api",
      url: "http://127.0.0.1:14310/api/v1/health",
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: "bun run dev:renderer",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
});
