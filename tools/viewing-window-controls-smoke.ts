import { _electron, expect } from "@playwright/test";
import { createServer } from "vite";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Exercise the real portal buttons and trusted opener IPC, without accounts,
// media capture or a database. Run against built main code or a packaged binary.
const server = await createServer({
  configFile: resolve("apps/desktop/vite.renderer.config.ts"),
  root: resolve("apps/desktop/src/renderer"),
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
const profile = await mkdtemp(join(tmpdir(), "cg-viewing-controls-"));
let app: Awaited<ReturnType<typeof _electron.launch>> | undefined;
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw Error("Viewing controls fixture server unavailable");
  app = await _electron.launch({
    ...(process.argv[2] ? { executablePath: resolve(process.argv[2]) } : {}),
    args: [
      ...(process.argv[2] ? [] : [resolve("apps/desktop/out/main/index.cjs")]),
      `--user-data-dir=${profile}`,
      "--mute-audio",
    ],
    env: { ...process.env, ELECTRON_RENDERER_URL: url },
  });
  const page = await app.firstWindow();
  await expect(page.locator(".app")).toBeVisible();
  await page.evaluate(async () => {
    const dependency = (name: string) => {
      const url = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .find((url) => new URL(url).pathname.endsWith(`/deps/${name}.js`));
      if (!url) throw Error(`Missing renderer dependency ${name}`);
      return url;
    };
    const React = (await import(dependency("react")))
      .default as typeof import("react");
    const { createRoot } = (await import(dependency("react-dom_client")))
      .default as typeof import("react-dom/client");
    const { ConfigProvider, theme } = (await import(
      dependency("antd")
    )) as typeof import("antd");
    const { useViewingWindow } = (await import(
      "/ui/ViewingWindow.tsx" as string
    )) as typeof import("../apps/desktop/src/renderer/ui/ViewingWindow");
    const host = document.body.appendChild(document.createElement("div"));
    host.style.cssText =
      "position:fixed;top:160px;left:340px;z-index:9999;background:#333;padding:20px";
    function Harness() {
      const viewing = useViewingWindow(true);
      return React.createElement(
        React.Fragment,
        null,
        viewing.control,
        viewing.presentation,
      );
    }
    createRoot(host).render(
      React.createElement(
        ConfigProvider,
        { theme: { algorithm: theme.darkAlgorithm } },
        React.createElement(Harness),
      ),
    );
  });
  const childPromise = app.waitForEvent("window");
  await page.getByRole("button", { name: "观看小窗", exact: true }).click();
  const child = await childPromise;
  const native = await app.browserWindow(child);
  const pinned = child.getByRole("button", { name: "取消置顶", exact: true });
  const unpinned = child.getByRole("button", { name: "置顶", exact: true });
  await expect(pinned).toHaveClass(/ant-btn-primary/);
  await expect(pinned).toHaveAttribute("aria-pressed", "true");
  expect(await native.evaluate((window) => window.isAlwaysOnTop())).toBe(true);
  expect(await child.evaluate(() => Boolean(window.desktop))).toBe(false);
  await pinned.click();
  await expect(unpinned).toHaveClass(/ant-btn-text/);
  await expect(unpinned).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => native.evaluate((window) => window.isAlwaysOnTop()))
    .toBe(false);
  await unpinned.click();
  await expect(pinned).toHaveClass(/ant-btn-primary/);
  await expect
    .poll(() => native.evaluate((window) => window.isAlwaysOnTop()))
    .toBe(true);
  const directory = resolve(".local/viewing-window-controls-verification");
  await mkdir(directory, { recursive: true });
  await child.screenshot({
    path: join(directory, `${process.platform}-pinned.png`),
  });
  await child.getByRole("button", { name: "返回主窗口", exact: true }).click();
  await expect.poll(() => child.isClosed()).toBe(true);
  const result = {
    platform: process.platform,
    actualButtonClicksToggleNativeState: true,
    pinnedStyleChanges: true,
    childHasNoDesktopBridge: true,
    returnButtonWorks: true,
    accountsCreated: false,
  };
  await writeFile(
    join(directory, `${process.platform}.json`),
    JSON.stringify(result),
  );
  console.log(JSON.stringify(result));
} finally {
  await app?.close();
  await server.close();
  await rm(profile, { recursive: true, force: true });
}
