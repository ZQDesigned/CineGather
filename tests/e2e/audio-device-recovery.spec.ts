import { test, expect } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";
type DeviceWindow = Window & {
  devices: Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">[];
  private?: boolean;
  captureCalls: MediaStreamConstraints["audio"][];
};
const preferences = {
  minimizeToTray: false,
  pushToTalk: false,
  pttShortcut: "Control+Shift+Space",
  muteShortcut: "Control+Shift+M",
  quality: "cinema",
  inputDevice: "saved-usb-id",
  outputDevice: "saved-headset-id",
  noiseReduction: "basic",
};
test("lost saved devices fall back persistently and never show opaque IDs; private inventories retain friendly placeholders", async ({
  page,
}) => {
  await page.addInitScript(
    ({ preferences }) => {
      localStorage.setItem("cinegather.settings", JSON.stringify(preferences));
      const w = window as unknown as DeviceWindow;
      w.devices = [
        { kind: "audioinput", deviceId: "saved-usb-id", label: "USB 麦克风" },
        { kind: "audioinput", deviceId: "default", label: "系统麦克风" },
        {
          kind: "audiooutput",
          deviceId: "saved-headset-id",
          label: "USB 耳机",
        },
        { kind: "audiooutput", deviceId: "default", label: "系统输出" },
      ];
      navigator.mediaDevices.enumerateDevices = async () =>
        w.devices as MediaDeviceInfo[];
      const query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = ((d: PermissionDescriptor) =>
        d.name === "microphone"
          ? Promise.resolve({ state: w.private ? "prompt" : "granted" })
          : query(d)) as typeof navigator.permissions.query;
    },
    { preferences },
  );
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备" }).click();
  await expect(
    page.getByRole("combobox", { name: "麦克风", exact: true }).locator(".."),
  ).toContainText("USB 麦克风");
  await page.evaluate(() => {
    const w = window as unknown as DeviceWindow;
    w.devices = w.devices.filter((d) => d.deviceId !== "saved-usb-id");
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("cinegather.settings")!).inputDevice,
      ),
    )
    .toBe("");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("cinegather.settings")!).outputDevice,
    ),
  ).toBe("saved-headset-id");
  await expect(
    page.getByRole("combobox", { name: "麦克风", exact: true }).locator(".."),
  ).toContainText("系统默认麦克风");
  await page.evaluate(() => {
    const w = window as unknown as DeviceWindow;
    w.devices = w.devices.filter((d) => d.deviceId !== "saved-headset-id");
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("cinegather.settings")!).outputDevice,
      ),
    )
    .toBe("");
  await expect(
    page
      .getByRole("combobox", { name: "扬声器 / 耳机", exact: true })
      .locator(".."),
  ).toContainText("系统默认输出");
  // Exercise a privacy-redacted inventory without claiming that all devices were removed.
  await page.evaluate(async () => {
    const w = window as unknown as DeviceWindow;
    w.private = true;
    w.devices = [{ kind: "audioinput", deviceId: "", label: "" }];
    const a = await import("/controller.ts" as string);
    await a.saveSettings(
      {
        ...JSON.parse(localStorage.getItem("cinegather.settings")!),
        inputDevice: "unknown-private-id",
        outputDevice: "",
      },
      false,
    );
  });
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置与设备" }).click();
  await expect(
    page.getByRole("combobox", { name: "麦克风", exact: true }).locator(".."),
  ).toContainText("已保存的麦克风（等待设备授权）");
  expect(await page.getByRole("dialog").innerText()).not.toContain(
    "unknown-private-id",
  );
});
test("unplug recovery retains muted intent and the next unmute uses the default input", async ({
  page,
}) => {
  await page.addInitScript(
    ({ preferences }) => {
      localStorage.setItem(
        "cinegather.settings",
        JSON.stringify({ ...preferences, outputDevice: "" }),
      );
      const w = window as unknown as DeviceWindow;
      w.devices = [
        { kind: "audioinput", deviceId: "saved-usb-id", label: "USB 麦克风" },
        { kind: "audioinput", deviceId: "default", label: "系统麦克风" },
      ];
      w.captureCalls = [];
      navigator.mediaDevices.enumerateDevices = async () =>
        w.devices as MediaDeviceInfo[];
      const original = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (c = {}) => {
        const next = structuredClone(c);
        w.captureCalls.push(c.audio);
        if (typeof next.audio === "object") delete next.audio.deviceId;
        return original(next);
      };
    },
    { preferences },
  );
  await page.goto("/");
  await registerTestAccount(page, "设备恢复静音测试");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("音频设备恢复本机验证");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(page.locator(".connection")).toContainText("已连接");
  await page.getByRole("button", { name: "关闭麦克风", exact: true }).click();
  const before = await page.evaluate(
    () => (window as unknown as DeviceWindow).captureCalls.length,
  );
  await page.evaluate(() => {
    const w = window as unknown as DeviceWindow;
    w.devices = w.devices.filter((d) => d.deviceId !== "saved-usb-id");
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("cinegather.settings")!).inputDevice,
      ),
    )
    .toBe("");
  await expect(
    page.getByRole("button", { name: "开启麦克风", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as DeviceWindow).captureCalls.length,
    ),
  ).toBe(before);
  await page.getByRole("button", { name: "开启麦克风", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "关闭麦克风", exact: true }),
  ).toBeVisible();
  const last = await page.evaluate(() =>
    (window as unknown as DeviceWindow).captureCalls.at(-1),
  );
  expect(JSON.stringify(last)).not.toContain("saved-usb-id");
  await page.getByRole("button", { name: "离开房间", exact: true }).click();
});

test("a disconnected microphone ends the settings test cleanly", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (options) => {
      const stream = await original(options);
      (window as unknown as { testInput: MediaStreamTrack }).testInput =
        stream.getAudioTracks()[0]!;
      return stream;
    };
  });
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备" }).click();
  await page.getByRole("button", { name: "测试麦克风", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停止测试", exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { testInput: MediaStreamTrack }
    ).testInput.dispatchEvent(new Event("ended")),
  );
  await expect(
    page.getByRole("button", { name: "测试麦克风", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { testInput: MediaStreamTrack }).testInput
          .readyState,
    ),
  ).toBe("ended");
});
