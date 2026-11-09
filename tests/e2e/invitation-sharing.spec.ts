import { test, expect } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";
import { parseInvitation } from "@cinegather/client-core";

test("desktop copies web invitation information and another client joins by pasting it", async ({
  page,
  browser,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      invitationCopy: "",
      desktop: {
        platform: "win32",
        loadSettings: async () => {
          throw Error("Use browser defaults");
        },
        onAction: () => () => {},
        takeInvitation: async () => undefined,
        setSharing: async () => {},
        cancelCapture: async () => {},
      },
    });
    navigator.clipboard.writeText = async (value) => {
      (window as unknown as { invitationCopy: string }).invitationCopy = value;
    };
  });
  await page.goto("/");
  await registerTestAccount(page, "邀请分享体验");
  await page.getByRole("button", { name: "创建私人房间", exact: true }).click();
  await page.getByLabel("房间名称").fill("一起看电影");
  await page.getByRole("button", { name: "创建并进入", exact: true }).click();
  await expect(page.locator(".connection")).toContainText("已连接");
  const other = await browser.newContext();
  const friend = await other.newPage();
  try {
    await page.getByRole("button", { name: "邀请朋友", exact: true }).click();
    const preview = page.getByLabel("房间邀请", { exact: true });
    const info = await preview.inputValue();
    expect(info).toMatch(
      /^邀请分享体验 邀请你加入映聚\n房间：一起看电影\n房间号：[A-Z0-9]{8}\n加入链接：http:\/\/127\.0\.0\.1:5180\//,
    );
    expect(info).not.toContain("cinegather:");
    const link = info
      .split("\n")
      .at(-1)!
      .replace(/^加入链接：/, "");
    expect(new URL(link).searchParams.has("invite")).toBe(false);
    expect(parseInvitation(info).inviteToken).toHaveLength(43);
    await page
      .getByRole("button", { name: "复制邀请信息", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { invitationCopy: string }).invitationCopy,
        ),
      )
      .toBe(info);
    await page.getByRole("button", { name: "仅复制链接", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { invitationCopy: string }).invitationCopy,
        ),
      )
      .toBe(link);
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await friend.goto("/");
    await registerTestAccount(friend, "邀请接收体验");
    await friend.getByRole("button", { name: "加入房间", exact: true }).click();
    await friend.getByLabel("房间号或邀请链接").fill(info);
    await expect(friend.getByLabel("房间密码（加密房必填）")).toHaveCount(0);
    await friend.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(
      friend.getByRole("heading", { name: "一起看电影", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".members-list .member")).toHaveCount(2);
    await friend.getByRole("button", { name: "离开房间", exact: true }).click();
    await expect(friend.locator(".connection")).toContainText("未连接房间");
    await friend.goto(link);
    await expect(friend).toHaveURL(new URL(link).origin + "/");
    await expect(
      friend.getByRole("dialog", { name: "加入朋友的房间", exact: true }),
    ).toBeVisible();
    await friend.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(
      friend.getByRole("heading", { name: "一起看电影", exact: true }),
    ).toBeVisible();
    await friend.getByRole("button", { name: "离开房间", exact: true }).click();
  } finally {
    await other.close();
    if (
      await page
        .getByRole("button", { name: "关闭对话框", exact: true })
        .isVisible()
    )
      await page
        .getByRole("button", { name: "关闭对话框", exact: true })
        .click();
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
  }
});

test("a web invitation passed on desktop launch survives until account onboarding", async ({
  baseURL,
}) => {
  test.skip(
    process.platform === "linux",
    "Native desktop verification requires macOS or Windows",
  );
  const { _electron } = await import("@playwright/test");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { join, resolve } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const profile = await mkdtemp(join(tmpdir(), "cg-web-invitation-"));
  const link = `https://cgplat.zqdesigned.city/?room=ABCD1234#invite=${"x".repeat(43)}`;
  const app = await _electron.launch({
    args: [
      resolve("apps/desktop/out/main/index.cjs"),
      `--user-data-dir=${profile}`,
      link,
    ],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: baseURL ?? "http://127.0.0.1:5173",
    },
  });
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("heading", { name: "欢迎来到映聚", exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "收到房间邀请，请先注册或登录账号" }),
    ).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
  }
});
