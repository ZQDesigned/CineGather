import { test, expect } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";
import { unzipSync, strFromU8 } from "fflate";
test("microphone noise reduction is configurable in shared audio settings and persists after reload", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  const select = page.getByRole("combobox", {
    name: "麦克风降噪",
    exact: true,
  });
  await expect(select).toBeVisible();
  await select.click();
  await page.getByRole("option", { name: "基础降噪", exact: true }).click();
  await page.getByRole("button", { name: "保存设置", exact: true }).click();
  await page.reload();
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  await expect(
    page.locator(".ant-select").filter({
      has: page.getByRole("combobox", { name: "麦克风降噪", exact: true }),
    }),
  ).toContainText("基础降噪");
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("cinegather.settings")!).noiseReduction,
    ),
  ).toBe("basic");
});

test("closing the microphone test during model loading stops the raw capture immediately", async ({
  page,
}) => {
  let loaded!: () => void;
  const loading = new Promise<void>((resolve) => {
    loaded = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/*.wasm*", async (route) => {
    if (route.request().resourceType() === "fetch") {
      loaded();
      await held;
    }
    await route.continue().catch(() => {});
  });
  await page.addInitScript(() => {
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await capture(constraints);
      Object.assign(window, { noiseTestStream: stream });
      return stream;
    };
  });
  try {
    await page.goto("/");
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("button", { name: "测试麦克风", exact: true }).click();
    await loading;
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as { noiseTestStream: MediaStream }
            ).noiseTestStream.getAudioTracks()[0]!.readyState,
        ),
      )
      .toBe("ended");
    release();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    release();
  }
});

test("changing noise reduction hot-applies to the room without unmuting a muted microphone", async ({
  page,
}) => {
  await page.goto("/");
  await registerTestAccount(page, "降噪切换测试");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("降噪验证房间");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "关闭麦克风", exact: true }),
  ).toBeEnabled();
  try {
    await page.getByRole("button", { name: "关闭麦克风", exact: true }).click();
    for (const [value, label] of [
      ["basic", "基础降噪"],
      ["off", "关闭降噪"],
      ["enhanced", "增强降噪"],
    ]) {
      await page
        .getByRole("button", { name: "音频设备设置", exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "麦克风降噪", exact: true })
        .click();
      await page.getByRole("option", { name: label, exact: true }).click();
      await page.getByRole("button", { name: "保存设置", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "开启麦克风", exact: true }),
      ).toBeEnabled();
      await page
        .getByRole("menuitem", { name: "连接诊断", exact: true })
        .click();
      const pending = page.waitForEvent("download");
      await page.getByRole("button", { name: "导出诊断", exact: true }).click();
      const stream = await (await pending).createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
      const files = unzipSync(Buffer.concat(chunks));
      const diagnostic = JSON.parse(strFromU8(files["current.json"]!));
      expect(diagnostic.microphoneNoise).toMatchObject({
        requested: value,
        active: value,
        ...(value === "enhanced" ? { engine: "deepfilternet3" } : {}),
      });
      await page
        .getByRole("button", { name: "关闭对话框", exact: true })
        .click();
    }
    await page.getByRole("button", { name: "开启麦克风", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeEnabled();
  } finally {
    if (await page.getByRole("dialog").count())
      await page
        .getByRole("button", { name: "关闭对话框", exact: true })
        .click();
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});
