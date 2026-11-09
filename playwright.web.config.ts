import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
export default defineConfig({
  ...base,
  testMatch: [
    "browser-web.spec.ts",
    "party-categories.spec.ts",
    "party-submissions.spec.ts",
    "noise-settings.spec.ts",
    "settings-page.spec.ts",
    "noise-migration.spec.ts",
    "required-update.spec.ts",
    "registration.spec.ts",
    "admin.spec.ts",
    "admin-roles.spec.ts",
    "lobby-room.spec.ts",
    "room-settings.spec.ts",
    "room-moderation.spec.ts",
    "member-permissions.spec.ts",
    "member-volume.spec.ts",
    "movie-playback.spec.ts",
    "accounts-lifecycle.spec.ts",
  ],
  outputDir: ".local/chrome-support/web-results",
  testIgnore: [],
  use: { ...base.use, channel: "chrome", baseURL: "http://127.0.0.1:5180" },
  webServer: [
    {
      command: "bun run dev:api",
      env: {
        CORS_ORIGINS: [
          ...new Set([
            ...(process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean),
            "http://127.0.0.1:5180",
            "http://localhost:5180",
          ]),
        ].join(","),
      },
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
