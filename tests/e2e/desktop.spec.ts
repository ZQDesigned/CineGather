import { test, expect, _electron as electron } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const executablePath = resolve(
  "apps/desktop/release/mac-arm64/CineGather.app/Contents/MacOS/CineGather",
);
test("packaged shortcut recording suspends global actions, captures the native input boundary and restores shortcuts after cancellation or blur", async () => {
  test.skip(
    process.platform !== "darwin" || !existsSync(executablePath),
    "Requires a local Mac package.",
  );
  const profile = await mkdtemp(
    join(tmpdir(), "cinegather-shortcut-recorder-"),
  );
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`],
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      w.show();
      w.focus();
    });
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("tab", { name: "共享与快捷键", exact: true }).click();
    const recorder = page.getByRole("button", {
      name: "全局麦克风静音",
      exact: true,
    });
    const registered = () =>
      app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("CommandOrControl+Shift+M"),
      );
    expect(await registered()).toBe(true);
    await recorder.click();
    await expect.poll(registered).toBe(false);
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents;
      // CDP/sendInputEvent bypass Electron's OS before-input-event path.
      // Drive that boundary here; real Mac key entry is checked separately.
      contents.emit(
        "before-input-event",
        { preventDefault() {} },
        { type: "keyDown", code: "KeyK", key: "k", meta: true, alt: true },
      );
    });
    await expect(recorder).toContainText("⌘ + ⌥ + K");
    await expect.poll(registered).toBe(true);
    // Cancelling does not replace the draft or close the settings modal.
    await recorder.click();
    await expect.poll(registered).toBe(false);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.webContents.emit(
        "before-input-event",
        { preventDefault() {} },
        { type: "keyDown", code: "Escape" },
      );
    });
    await expect(recorder).toContainText("⌘ + ⌥ + K");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect.poll(registered).toBe(true);
    await recorder.click();
    await expect.poll(registered).toBe(false);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.hide(),
    );
    await expect.poll(registered).toBe(true);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]!;
      w.show();
      w.focus();
    });
    await expect(recorder).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    expect(
      await page.evaluate(
        async () => (await window.desktop!.loadSettings()).muteShortcut,
      ),
    ).toBe("Command+Alt+K");
    expect(
      await app.evaluate(({ globalShortcut }) =>
        globalShortcut.isRegistered("Command+Alt+K"),
      ),
    ).toBe(true);
    await page.screenshot({ path: ".local/ui-compact/native-key-capture.png" });
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
test("packaged desktop starts with a sandboxed renderer and the minimal typed bridge", async () => {
  test.skip(
    process.platform !== "darwin" || !existsSync(executablePath),
    "Build the Mac package first. Windows CI performs its own package smoke test.",
  );
  const profile = await mkdtemp(join(tmpdir(), "cinegather-smoke-"));
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`],
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "给自己一个名字" }),
    ).toBeVisible();
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]!
        .webContents as unknown as {
        getLastWebPreferences(): {
          sandbox: boolean;
          contextIsolation: boolean;
          nodeIntegration: boolean;
        };
      };
      const p = contents.getLastWebPreferences();
      return {
        sandbox: p.sandbox,
        contextIsolation: p.contextIsolation,
        nodeIntegration: p.nodeIntegration,
      };
    });
    expect(preferences).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
    const bridge = await page.evaluate(() => ({
      platform: window.desktop?.platform,
      node: typeof (window as unknown as { require?: unknown }).require,
      keys: Object.keys(window.desktop ?? {}),
    }));
    expect(bridge.platform).toBe("darwin");
    expect(bridge.node).toBe("undefined");
    expect(bridge.keys).not.toContain("invoke");
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.screenshot({ path: ".local/desktop-settings.png" });
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
test("a first-launch invitation waits for guest onboarding instead of being lost before the renderer subscribes", async () => {
  test.skip(
    process.platform !== "darwin" || !existsSync(executablePath),
    "Requires a local Mac package.",
  );
  const profile = await mkdtemp(join(tmpdir(), "cinegather-invite-smoke-"));
  const invite = `cinegather://join?room=00000000-0000-4000-8000-000000000000&invite=${"x".repeat(43)}`;
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`, invite],
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "给自己一个名字" }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toContainText(
      "收到房间邀请，请先输入昵称",
    );
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("packaged capture permissions require source approval while camera capture stays denied", async () => {
  test.skip(
    process.platform !== "darwin" || !existsSync(executablePath),
    "Requires a local Mac package.",
  );
  const profile = await mkdtemp(join(tmpdir(), "cinegather-capture-gate-"));
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${profile}`],
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByLabel("你的昵称")).toBeVisible();
    // Replace only the OS capture boundary: every request is rejected without
    // opening a native picker or starting a device, after the real permission gate.
    await app.evaluate(({ BrowserWindow, desktopCapturer, nativeImage }) => {
      desktopCapturer.getSources = async () => [
        {
          id: "screen:permission-regression",
          name: "Permission regression source",
          display_id: "0",
          appIcon: nativeImage.createEmpty(),
          thumbnail: nativeImage.createEmpty(),
        },
      ];
      const state = globalThis as unknown as { captureRequests: number };
      state.captureRequests = 0;
      BrowserWindow.getAllWindows()[0]!.webContents.session.setDisplayMediaRequestHandler(
        (_request, callback) => {
          state.captureRequests++;
          callback(null);
        },
        { useSystemPicker: false },
      );
    });
    const requestCapture = () =>
      page.evaluate(async () => {
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
          });
          stream.getTracks().forEach((track) => track.stop());
          return "unexpected grant";
        } catch (error) {
          return (error as Error).name;
        }
      });
    const requestCount = () =>
      app.evaluate(
        () =>
          (globalThis as unknown as { captureRequests: number })
            .captureRequests,
      );
    expect(await requestCapture()).toBe("NotAllowedError");
    expect(await requestCount()).toBe(0);
    // Native macOS capture never opens browser display-media permission.
    if (await page.evaluate(() => window.desktop?.nativeCapture)) {
      await expect(
        page.evaluate(() =>
          window.desktop!.selectSource({
            sourceId: "screen:permission-regression",
            systemAudio: false,
          }),
        ),
      ).rejects.toThrow();
      expect(await requestCount()).toBe(0);
    } else {
      await page.evaluate(() =>
        window.desktop!.selectSource({
          sourceId: "screen:permission-regression",
          systemAudio: false,
        }),
      );
      await requestCapture();
      expect(await requestCount()).toBe(1);
    }
    expect(
      await page.evaluate(async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: true,
          });
          stream.getTracks().forEach((track) => track.stop());
          return "unexpected grant";
        } catch (error) {
          return (error as Error).name;
        }
      }),
    ).toBe("NotAllowedError");
    await page.evaluate(() => window.desktop!.cancelCapture());
    await requestCapture();
    expect(await requestCount()).toBe(
      await page.evaluate(() => (window.desktop?.nativeCapture ? 0 : 1)),
    );
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("packaged global hold uses the native state boundary, combines foreground hold and releases in the background or on lock", async () => {
  test.skip(
    process.platform !== "darwin" || !existsSync(executablePath),
    "Requires a local Mac package.",
  );
  const profile = await mkdtemp(join(tmpdir(), "cinegather-global-hold-"));
  const app = await electron.launch({
    executablePath,
    args: [
      `--user-data-dir=${profile}`,
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ globalShortcut, BrowserWindow }) => {
      type Probe = {
        down?: boolean;
        nativeReads: number;
        releases: number;
        press?: () => void;
      };
      const state = globalThis as unknown as { holdProbe: Probe };
      state.holdProbe = { nativeReads: 0, releases: 0 };
      const contents = BrowserWindow.getAllWindows()[0]!.webContents;
      const send = contents.send.bind(contents);
      contents.send = (channel, ...args) => {
        if (channel === "desktop:action" && args[0] === "ptt-release")
          state.holdProbe.releases++;
        send(channel, ...args);
      };
      const load = process
        .getBuiltinModule("module")
        .createRequire(`${process.resourcesPath}/native/fixture.cjs`);
      const ffi = load(
        `${process.resourcesPath}/native/node_modules/koffi/index.cjs`,
      ) as {
        load(path: string): {
          func(signature: string): (...args: number[]) => boolean;
        };
      };
      const original = ffi.load;
      ffi.load = (path) => {
        const library = original(path);
        const declare = library.func.bind(library);
        return {
          func: (signature) => {
            const native = declare(signature);
            return (...args) => {
              state.holdProbe.nativeReads++;
              return state.holdProbe.down ?? native(...args);
            };
          },
        };
      };
      const register = globalShortcut.register.bind(globalShortcut);
      globalShortcut.register = (key, callback) => {
        if (key === "Control+Alt+K") state.holdProbe.press = callback;
        return register(key, callback);
      };
    });
    await page.getByLabel("你的昵称").fill("全局按住说话验证");
    await page.getByRole("button", { name: "进入映聚", exact: true }).click();
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("全局组合键验证");
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    await page
      .getByRole("button", { name: "关闭麦克风", exact: true })
      .waitFor();
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("tab", { name: "共享与快捷键", exact: true }).click();
    await page.getByRole("checkbox", { name: "按键说话" }).check();
    await page
      .getByRole("button", { name: "全局按住说话", exact: true })
      .click();
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]!.webContents;
      contents.emit(
        "before-input-event",
        { preventDefault() {} },
        { type: "keyDown", code: "KeyK", key: "k", control: true, alt: true },
      );
    });
    await expect(
      page.getByRole("button", { name: "全局按住说话", exact: true }),
    ).toContainText("⌃ + ⌥ + K");
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeVisible();
    const press = (down?: boolean) =>
      app.evaluate((_electron, held) => {
        const probe = (
          globalThis as unknown as {
            holdProbe: { down?: boolean; press(): void };
          }
        ).holdProbe;
        probe.down = held;
        probe.press();
      }, down);
    // Real FFI reads the released key state before the OS boundary is controlled.
    await press();
    expect(
      await app.evaluate(
        () =>
          (globalThis as unknown as { holdProbe: { nativeReads: number } })
            .holdProbe.nativeReads,
      ),
    ).toBeGreaterThan(0);
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeVisible();
    await press(true);
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeVisible();
    // A native global chord containing Space must not also acquire the foreground
    // plain-Space hold, otherwise releasing a modifier could leave the mic open.
    await page.evaluate(() =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          ctrlKey: true,
          altKey: true,
          bubbles: true,
        }),
      ),
    );
    await app.evaluate(() => {
      (
        globalThis as unknown as { holdProbe: { down: boolean } }
      ).holdProbe.down = false;
    });
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeVisible();
    await page.evaluate(() =>
      document.body.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Space", bubbles: true }),
      ),
    );
    await press(true);
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeVisible();
    const releasesBeforeWindow = await app.evaluate(
      () =>
        (globalThis as unknown as { holdProbe: { releases: number } }).holdProbe
          .releases,
    );
    await page.evaluate(() =>
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { code: "Space", bubbles: true }),
      ),
    );
    await app.evaluate(() => {
      (
        globalThis as unknown as { holdProbe: { down: boolean } }
      ).holdProbe.down = false;
    });
    // Wait for the real main-process release; foreground Space still owns its hold.
    await expect
      .poll(() =>
        app.evaluate(
          () =>
            (globalThis as unknown as { holdProbe: { releases: number } })
              .holdProbe.releases,
        ),
      )
      .toBeGreaterThan(releasesBeforeWindow);
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeVisible();
    await page.evaluate(() =>
      document.body.dispatchEvent(
        new KeyboardEvent("keyup", { code: "Space", bubbles: true }),
      ),
    );
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeVisible();
    await press(true);
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.hide(),
    );
    await app.evaluate(() => {
      (
        globalThis as unknown as { holdProbe: { down: boolean } }
      ).holdProbe.down = false;
    });
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeVisible();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.show(),
    );
    await press(true);
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeVisible();
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit("lock-screen"));
    await expect(
      page.evaluate(() => window.desktop!.sources()),
    ).rejects.toThrow("锁定");
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeVisible();
    await press(true);
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeVisible();
    await app.evaluate(({ powerMonitor }) =>
      powerMonitor.emit("unlock-screen"),
    );
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test("a failed startup hotkey keeps saved push-to-talk enabled and joins muted", async () => {
  test.skip(
    process.platform !== "darwin" || !existsSync(executablePath),
    "Requires a local Mac package.",
  );
  const profile = await mkdtemp(join(tmpdir(), "cinegather-hotkey-failure-"));
  await writeFile(
    join(profile, "settings.json"),
    JSON.stringify({
      minimizeToTray: true,
      pushToTalk: true,
      pttShortcut: "Control+Unknown",
      muteShortcut: "CommandOrControl+Shift+M",
      quality: "cinema",
      inputDevice: "",
      outputDevice: "",
    }),
  );
  const app = await electron.launch({
    executablePath,
    args: [
      `--user-data-dir=${profile}`,
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole("alert")).toContainText("全局快捷键不可用");
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("tab", { name: "共享与快捷键", exact: true }).click();
    await expect(
      page.getByRole("checkbox", { name: "按键说话" }),
    ).toBeChecked();
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await page.getByLabel("你的昵称").fill("快捷键失效保持静音");
    await page.getByRole("button", { name: "进入映聚", exact: true }).click();
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("默认静音验证");
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
