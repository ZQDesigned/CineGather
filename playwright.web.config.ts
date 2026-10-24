import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig(base, {
  testMatch: [
    "browser-web.spec.ts",
    "noise-settings.spec.ts",
    "required-update.spec.ts",
    "registration.spec.ts",
    "admin.spec.ts",
    "admin-roles.spec.ts",
    "lobby-room.spec.ts",
    "accounts-lifecycle.spec.ts",
  ],
  outputDir: ".local/chrome-support/web-results",
  testIgnore: [],
  use: { channel: "chrome", baseURL: "http://127.0.0.1:5180" },
  webServer: [
    {
      command: "bun run dev:api",
      url: "http://127.0.0.1:14310/api/v1/health",
      reuseExistingServer: true,
      timeout: 30000,
    },
    {
      command: "bun run serve:web",
      url: "http://127.0.0.1:5180",
      reuseExistingServer: true,
      timeout: 30000,
    },
  ],
});
