import { _electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { defaultSettings } from "../apps/desktop/src/shared/settings";
const profile = await mkdtemp(join(tmpdir(), "cg-update-gate-"));
await writeFile(
  join(profile, "settings.json"),
  JSON.stringify({
    ...defaultSettings,
    autoDownloadUpdates: false,
    muteShortcut: "Control+Alt+Shift+F10",
  }),
);
const app = await _electron.launch({
  executablePath: resolve(
    process.argv[2] ?? "apps/desktop/release/win-unpacked/CineGather.exe",
  ),
  args: [`--user-data-dir=${profile}`, "--mute-audio"],
});
try {
  const page = await app.firstWindow();
  await expect(page.locator(".app")).toBeVisible();
  const version = await app.evaluate(({ app }) => app.getVersion());
  const parts = version.split(".").map(Number),
    minimumVersion = `${parts[0]}.${parts[1]}.${parts[2]! + 1}`;
  await page.evaluate(async (minimum) => {
    const events: unknown[] = [];
    Object.assign(window, { gateProbe: events });
    window.desktop!.updates!.onChange((s) => events.push(s));
    await window.desktop!.updates!.requireUpdate!(minimum, "服务端说明");
  }, minimumVersion);
  const gate = page.getByRole("dialog", { name: "需要更新映聚" });
  await expect(gate).toContainText("服务端说明");
  await page.evaluate(async (minimum) => {
    for (let i = 0; i < 50; i++)
      await window.desktop!.updates!.requireUpdate!(
        minimum,
        i % 2 ? "服务端说明" : "清单说明",
      );
  }, minimumVersion);
  await page.waitForTimeout(500);
  await expect(gate).toContainText("服务端说明");
  await expect(gate).not.toContainText("清单说明");
  const count = await page.evaluate(
    () =>
      (
        window as unknown as {
          gateProbe: { required?: boolean; minimumVersion?: string }[];
        }
      ).gateProbe.filter((s) => s.required && s.minimumVersion).length,
  );
  expect(count).toBeGreaterThanOrEqual(1);
  const conflicting = await page.evaluate(
    () =>
      (
        window as unknown as { gateProbe: { reason?: string }[] }
      ).gateProbe.filter((s) => s.reason === "清单说明").length,
  );
  expect(conflicting).toBe(0);
  const directory = resolve(".local/update-gate-verification");
  await mkdir(directory, { recursive: true });
  const result = {
    platform: process.platform,
    version,
    sameVersionReasonStable: true,
    sameCutoffReasonChanges: conflicting,
    requiredEvents: count,
  };
  await writeFile(
    join(directory, process.platform + ".json"),
    JSON.stringify(result),
  );
  console.log(JSON.stringify(result));
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
