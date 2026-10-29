import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { registerTestAccount } from "./helpers/account";
test("room audio arrow applies devices and noise immediately without unmuting or opening full settings", async ({
  page,
}) => {
  let room: string | undefined;
  await page.addInitScript(() => {
    const capture = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    Object.assign(window, { audioCaptureCalls: [] as unknown[] });
    navigator.mediaDevices.getUserMedia = async (c) => {
      (
        window as unknown as { audioCaptureCalls: unknown[] }
      ).audioCaptureCalls.push(c);
      return capture(c);
    };
  });
  await page.goto("/");
  await registerTestAccount(page, "房间音频快捷设置测试");
  const user = await page.evaluate(async () => {
    const { state } = await import("/store.ts" as string);
    return state().user.id;
  });
  try {
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("音频快捷设置验证");
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeEnabled();
    room = await page.evaluate(async () => {
      const { state } = await import("/store.ts" as string);
      return state().room.id;
    });
    await page.getByRole("button", { name: "关闭麦克风", exact: true }).click();
    const before = await page.evaluate(
      () =>
        (window as unknown as { audioCaptureCalls: unknown[] })
          .audioCaptureCalls.length,
    );
    const arrow = page.getByRole("button", {
      name: "音频快捷设置",
      exact: true,
    });
    await arrow.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const panel = page.getByRole("region", {
      name: "音频快捷设置",
      exact: true,
    });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "保存设置", exact: true }),
    ).toHaveCount(0);
    const select = async (label: string, option: string) => {
      await panel.getByRole("combobox", { name: label, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
      await expect(
        panel.getByRole("combobox", { name: label, exact: true }),
      ).toBeEnabled();
    };
    await panel.getByRole("combobox", { name: "麦克风", exact: true }).click();
    const input = page.getByRole("option").last(),
      inputLabel = await input.innerText();
    expect(inputLabel).not.toBe("系统默认麦克风");
    await input.click();
    await expect(
      panel.getByRole("combobox", { name: "麦克风", exact: true }),
    ).toBeEnabled();
    const read = () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("cinegather.settings")!),
      );
    await expect.poll(async () => (await read()).inputDevice).not.toBe("");
    const inputId = (await read()).inputDevice;
    await select("麦克风降噪", "基础降噪");
    await expect.poll(async () => (await read()).noiseReduction).toBe("basic");
    await panel
      .getByRole("combobox", { name: "扬声器 / 耳机", exact: true })
      .click();
    const output = page.getByRole("option").last();
    expect(await output.innerText()).not.toBe("系统默认输出");
    await output.click();
    await expect(
      panel.getByRole("combobox", { name: "扬声器 / 耳机", exact: true }),
    ).toBeEnabled();
    await expect.poll(async () => (await read()).outputDevice).not.toBe("");
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { audioCaptureCalls: unknown[] })
            .audioCaptureCalls.length,
      ),
    ).toBe(before);
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    await page.getByRole("button", { name: "开启麦克风", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { audioCaptureCalls: unknown[] })
              .audioCaptureCalls.length,
        ),
      )
      .toBeGreaterThan(before);
    expect(
      JSON.stringify(
        await page.evaluate(() =>
          (
            window as unknown as { audioCaptureCalls: unknown[] }
          ).audioCaptureCalls.at(-1),
        ),
      ),
    ).toContain(inputId);
    await page.getByRole("button", { name: "关闭麦克风", exact: true }).click();
    await arrow.click();
    await select("麦克风", "系统默认麦克风");
    await select("扬声器 / 耳机", "系统默认输出");
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("combobox", { name: "麦克风降噪", exact: true })
        .locator(".."),
    ).toContainText("基础降噪");
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
  } finally {
    await page
      .evaluate(async () => {
        const a = await import("/controller.ts" as string);
        await a.roomSession.leave();
      })
      .catch(() => {});
    if (user)
      execFileSync(
        "bun",
        [
          "tests/e2e/helpers/cleanup-room-invitations.ts",
          JSON.stringify({ users: [user], rooms: room ? [room] : [] }),
        ],
        { stdio: "pipe" },
      );
  }
});
