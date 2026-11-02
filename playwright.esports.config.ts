import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig } from "@playwright/test";
if (existsSync(".env")) loadEnvFile(".env");
if (
  !process.env.DATABASE_URL ||
  (!new URL(process.env.DATABASE_URL).pathname.includes("esports") &&
    !process.env.CI)
)
  throw Error("Set an isolated esports DATABASE_URL before running this suite");
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "esports-rooms.spec.ts",
  workers: 1,
  timeout: 45000,
  outputDir: ".local/esports-rooms/browser-results",
  use: {
    channel: "chrome",
    baseURL: "http://127.0.0.1:5181",
    viewport: { width: 1366, height: 850 },
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--mute-audio",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  webServer: [
    {
      command: "bun apps/api/src/main.ts",
      env: {
        API_PORT: "17883",
        CORS_ORIGINS: "http://127.0.0.1:5181",
        ESPORTS_GATEWAY_URL: "ws://127.0.0.1:17883",
        ESPORTS_ADMISSION_SECRET:
          process.env.ESPORTS_ADMISSION_SECRET ?? "fixture".repeat(12),
      },
      url: "http://127.0.0.1:17883/api/v1/health",
      reuseExistingServer: false,
    },
    {
      command: "bunx vite --config apps/desktop/vite.web.config.ts --port 5181",
      env: {
        WEB_API_URL: "http://127.0.0.1:17883",
        WEB_API_PROXY: "http://127.0.0.1:17883",
      },
      url: "http://127.0.0.1:5181",
      reuseExistingServer: false,
    },
  ],
});
