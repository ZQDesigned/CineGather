import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { registerTestAccount, testPassword } from "./helpers/account";
test("site announcements preview, broadcast, survive offline/reload, schedule, end and withdraw with a dedicated dialog", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(150000);
  const context = await browser.newContext(),
    viewer = await context.newPage();
  const second = await browser.newContext(),
    other = await second.newPage();
  let offlineContext = await browser.newContext();
  let offline = await offlineContext.newPage();
  const ids: string[] = [];
  const userId = (p: Page) =>
    p.evaluate(async () => {
      const { state } = await import("/store.ts" as string);
      return state().user.id;
    });
  const title = "维护安排 " + crypto.randomUUID().slice(0, 6),
    body =
      "测试维护通知\n<script>window.__announcementInjected=true</script>\n此文字只在本地测试。";
  const make = async (name: string) => {
    await page.getByRole("button", { name: "新建公告", exact: true }).click();
    const d = page.getByRole("dialog", { name: "新建公告", exact: true });
    await d.getByLabel("公告标题", { exact: true }).fill(name);
    await d.getByLabel("公告内容", { exact: true }).fill(body);
    await d
      .getByRole("radio", { name: "维护公告（显示横幅）", exact: true })
      .check();
    return d;
  };
  const row = (name: string) => page.getByRole("row").filter({ hasText: name });
  try {
    await page.goto("/");
    await registerTestAccount(page, "公告管理员体验");
    ids.push(await userId(page));
    execFileSync(
      "bun",
      [
        "tests/e2e/helpers/announcement-fixtures.ts",
        JSON.stringify({ operation: "grant", users: [ids[0]] }),
      ],
      { stdio: "pipe" },
    );
    await page.reload();
    await page.getByRole("menuitem", { name: "管理后台", exact: true }).click();
    await page.getByRole("tab", { name: "公告管理", exact: true }).click();
    await viewer.goto("/");
    await registerTestAccount(viewer, "公告接收体验");
    ids.push(await userId(viewer));
    const viewerUsername = await viewer.evaluate(async () => {
      const { state } = await import("/store.ts" as string);
      return state().user.username;
    });
    await offline.goto("/");
    await registerTestAccount(offline, "离线公告体验");
    ids.push(await userId(offline));
    const offlineUsername = await offline.evaluate(async () => {
      const { state } = await import("/store.ts" as string);
      return state().user.username;
    });
    await offlineContext.close();
    const d = await make(title);
    await d.getByRole("tab", { name: "预览", exact: true }).click();
    await expect(d.getByLabel("公告正文", { exact: true })).toContainText(
      "<script>",
    );
    await d.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(d).not.toBeVisible();
    await expect(row(title)).toContainText("草稿");
    await expect(
      viewer.getByRole("status", { name: "维护公告", exact: true }),
    ).toHaveCount(0);
    await row(title).getByRole("button", { name: "发布", exact: true }).click();
    await page
      .getByRole("dialog", { name: "确认发布全站公告", exact: true })
      .getByRole("button", { name: "确认发布", exact: true })
      .click();
    const notice = viewer.getByRole("dialog", { name: title, exact: true });
    await expect(notice).toBeVisible({ timeout: 15000 });
    await expect(notice).toContainText(
      "<script>window.__announcementInjected=true</script>",
    );
    expect(
      await viewer.evaluate(
        () =>
          !!(window as unknown as { __announcementInjected?: boolean })
            .__announcementInjected,
      ),
    ).toBe(false);
    const banner = viewer.getByRole("status", {
      name: "维护公告",
      exact: true,
    });
    await expect(banner).toContainText(title);
    await viewer.screenshot({
      path: info.outputPath("announcement-dialog.png"),
      animations: "disabled",
    });
    await notice.getByRole("button", { name: "知道了", exact: true }).click();
    const authorNotice = page.getByRole("dialog", { name: title, exact: true });
    await expect(authorNotice).toBeVisible({ timeout: 10000 });
    await authorNotice
      .getByRole("button", { name: "知道了", exact: true })
      .click();
    const token = await viewer.evaluate(
      () => localStorage.getItem("cinegather.session")!,
    );
    await other.goto("/");
    await other.getByLabel("用户名", { exact: true }).fill(viewerUsername);
    await other.getByLabel("密码", { exact: true }).fill(testPassword);
    await other.getByRole("button", { name: "登录映聚", exact: true }).click();
    await expect(
      other.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeVisible();
    expect(
      await other.evaluate(() => localStorage.getItem("cinegather.session")),
    ).not.toBe(token);
    await expect
      .poll(() =>
        other.evaluate(async (title) => {
          const { state } = await import("/store.ts" as string);
          return state().announcements.items.some(
            (a: { title: string }) => a.title === title,
          );
        }, title),
      )
      .toBe(true);
    await expect(
      other.getByRole("dialog", { name: title, exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(() =>
        other.evaluate(async (title) => {
          const { state } = await import("/store.ts" as string);
          return state().notifications.some(
            (a: { title: string; target: string; read: boolean }) =>
              a.title === title && a.target === "announcements" && a.read,
          );
        }, title),
      )
      .toBe(true);
    await viewer.reload();
    await expect(banner).toContainText(title);
    await expect(
      viewer.getByRole("dialog", { name: title, exact: true }),
    ).toHaveCount(0);
    await viewer.route("**/api/v1/announcements**", (r) => r.abort());
    await viewer.reload();
    await expect(banner).toContainText(title);
    await expect(
      viewer.getByRole("dialog", { name: title, exact: true }),
    ).toHaveCount(0);
    await viewer.unroute("**/api/v1/announcements**");
    await viewer.evaluate(async () => {
      const { siteAnnouncements } = await import("/controller.ts" as string);
      await siteAnnouncements.refresh();
    });
    await viewer.getByRole("button", { name: /^通知(?:，|$)/ }).click();
    await viewer.getByRole("button", { name: "全站公告", exact: true }).click();
    const history = viewer.getByRole("dialog", {
      name: "全站公告",
      exact: true,
    });
    await expect(history).toContainText(title);
    await history.getByRole("button", { name: "知道了", exact: true }).click();
    offlineContext = await browser.newContext();
    offline = await offlineContext.newPage();
    await offline.goto("/");
    await offline.getByLabel("用户名", { exact: true }).fill(offlineUsername);
    await offline.getByLabel("密码", { exact: true }).fill(testPassword);
    await offline
      .getByRole("button", { name: "登录映聚", exact: true })
      .click();
    const offlineNotice = offline.getByRole("dialog", {
      name: title,
      exact: true,
    });
    await expect(offlineNotice).toBeVisible({ timeout: 10000 });
    await offlineNotice
      .getByRole("button", { name: "知道了", exact: true })
      .click();
    await row(title).getByRole("button", { name: "撤回", exact: true }).click();
    await page
      .getByRole("dialog", { name: "撤回公告", exact: true })
      .getByRole("button", { name: "确认撤回", exact: true })
      .click();
    await expect(banner).toHaveCount(0, { timeout: 10000 });
    const scheduledTitle = "定时公告 " + crypto.randomUUID().slice(0, 6),
      editor = await make(scheduledTitle);
    await editor
      .getByRole("checkbox", { name: "弹窗提醒", exact: true })
      .uncheck();
    await editor.getByRole("radio", { name: "定时发送", exact: true }).check();
    const start = new Date(Date.now() + 120000),
      end = new Date(Date.now() + 180000),
      local = (d: Date) =>
        new Date(d.getTime() - d.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
    await editor.getByLabel("定时发送时间", { exact: true }).fill(local(start));
    await editor.getByRole("radio", { name: "指定时间", exact: true }).check();
    await editor.getByLabel("指定结束时间", { exact: true }).fill(local(end));
    await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect(row(scheduledTitle)).toContainText("草稿");
    await page.evaluate(async (title) => {
      const { api } = await import("/controller.ts" as string);
      const result = await api.GET("/api/v1/admin/announcements", {
        params: { query: { q: title } },
      });
      const a = result.data!.items.find(
        (a: { title: string }) => a.title === title,
      )!;
      const now = Date.now();
      const r = await api.PATCH(
        "/api/v1/admin/announcements/{announcementId}",
        {
          params: { path: { announcementId: a.id } },
          body: {
            title: a.title,
            body: a.body,
            kind: a.kind,
            popup: false,
            startsAt: new Date(now + 5000).toISOString(),
            expiresAt: new Date(now + 13000).toISOString(),
          },
        },
      );
      if (r.error) throw Error("Local schedule fixture failed");
    }, scheduledTitle);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await row(scheduledTitle)
      .getByRole("button", { name: "发布", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "确认安排全站公告", exact: true })
      .getByRole("button", { name: "确认定时发送", exact: true })
      .click();
    await expect(row(scheduledTitle)).toContainText("待发送");
    await expect(banner).toContainText(scheduledTitle, { timeout: 12000 });
    await expect(
      viewer.getByRole("dialog", { name: scheduledTitle, exact: true }),
    ).toHaveCount(0);
    await viewer.screenshot({
      path: info.outputPath("announcement-banner.png"),
      animations: "disabled",
    });
    await expect(banner).toHaveCount(0, { timeout: 15000 });
    console.log(
      JSON.stringify({
        previewPlainText: true,
        liveDialog: true,
        notificationHistory: true,
        crossDeviceOncePerAccount: true,
        offlineCatchUp: true,
        offlineCache: true,
        withdrawRemovesBanner: true,
        scheduleAndAutomaticEnd: true,
        productionBroadcastsSent: 0,
      }),
    );
  } catch (error) {
    console.error(
      "Announcement scenario failed",
      String(error),
      await viewer
        .evaluate(async () => {
          const { state } = await import("/store.ts" as string);
          const s = state();
          return {
            modal: s.modal,
            busy: s.busy,
            pending: s.pendingAnnouncementIds,
            preferences: s.settings.notifications,
            items: s.announcements.items.map(
              (a: {
                id: string;
                popup: boolean;
                state: string;
                startsAt: string | null;
              }) => ({
                id: a.id,
                popup: a.popup,
                state: a.state,
                startsAt: a.startsAt,
              }),
            ),
            offset: s.announcements.offset,
          };
        })
        .catch(() => undefined),
    );
    throw error;
  } finally {
    await context.close();
    await second.close();
    await offlineContext.close();
    if (ids.length) {
      execFileSync(
        "bun",
        [
          "tests/e2e/helpers/announcement-fixtures.ts",
          JSON.stringify({ operation: "cleanup", users: ids }),
        ],
        { stdio: "pipe" },
      );
      execFileSync(
        "bun",
        [
          "tests/e2e/helpers/cleanup-room-invitations.ts",
          JSON.stringify({ users: ids, rooms: [] }),
        ],
        { stdio: "pipe" },
      );
    }
  }
});
