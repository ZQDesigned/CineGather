import { test, expect, type Page } from "@playwright/test";
import type { AdminGame, AdminRoom, AdminUser } from "@cinegather/contracts";
const id = "24a10c81-c87e-4aa0-8dc1-3d4c772ed3c6";
const createdAt = "2026-11-06T00:00:00.000Z";
const user: AdminUser = {
  id,
  username: "motion_admin",
  displayName: "动画回归",
  isSuperAdmin: true,
  screenShareEnabled: false,
  gameHostEnabled: true,
  esportsRoomsEnabled: false,
  highFrameRateEnabled: false,
  standardRoomMaxMembers: 10,
  roles: [],
  disabledAt: null,
  createdAt,
  activeSessions: 1,
};
const game: AdminGame = {
  id,
  name: "动画联机",
  code: "ABCDEFGH",
  game: "minecraft-java",
  gameVersion: null,
  hostUserId: id,
  hostName: user.displayName,
  hostUsername: user.username,
  status: "open",
  memberCount: 1,
  maxMembers: 8,
  createdAt,
  endedAt: null,
};
const room: AdminRoom = {
  id,
  name: "动画房间",
  code: "ABCDEF12",
  ownerName: user.displayName,
  status: "closed",
  access: "normal",
  memberCount: 0,
  maxMembers: 5,
  sharing: false,
  createdAt,
};
const emptyGame = {
  session: null,
  self: null,
  members: [],
  requests: [],
  invitations: [],
};
async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("cinegather.api", location.origin);
    localStorage.setItem("cinegather.session", "isolated-motion-fixture");
  });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    let body: unknown = { items: [], total: 0, visibility: "online" };
    if (path === "/me") body = user;
    else if (path === "/feature-policy")
      body = { format: 1, revision: 1, rules: [] };
    else if (path === "/games") body = emptyGame;
    else if (path === "/admin/users") body = { items: [user], total: 1 };
    else if (path === "/admin/games") body = { items: [game], total: 1 };
    else if (path === "/admin/rooms") body = { items: [room], total: 1 };
    else if (path.endsWith("/events"))
      body = {
        items: [
          {
            id,
            actorName: user.displayName,
            action: path.includes("/games/") ? "game.created" : "room.created",
            sessionName: "动画内容",
            sessionCode: "ABCDEFGH",
            memberName: "",
            reason: "",
            createdAt,
          },
        ],
        total: 1,
      };
    else if (path === "/admin/overview")
      body = {
        accounts: 1,
        disabledAccounts: 0,
        activeRooms: 0,
        activeSessions: 1,
        service: "available",
        version: "test",
      };
    else if (path === "/admin/announcements")
      body = {
        items: [
          {
            id,
            title: "动画公告",
            body: "关闭期间必须保留这段公告内容",
            kind: "notice",
            state: "published",
            startsAt: null,
            expiresAt: null,
            publishedAt: createdAt,
            createdAt,
            updatedAt: createdAt,
          },
        ],
        total: 1,
      };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#/admin");
  await expect(
    page.getByRole("heading", { name: "管理后台", exact: true }),
  ).toBeVisible();
}
async function closeWithMotion(page: Page, close: () => Promise<unknown>) {
  await expect(page.getByRole("dialog")).toBeVisible();
  const content = await page.locator(".ant-modal").innerText();
  await page.evaluate(() => {
    const w = window as unknown as {
      motionProbe?: { names: string[]; installed: boolean };
    };
    if (!w.motionProbe) w.motionProbe = { names: [], installed: false };
    w.motionProbe.names = [];
    if (w.motionProbe.installed) return;
    w.motionProbe.installed = true;
    document.addEventListener("animationstart", (event) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.matches(".ant-modal,.ant-modal-mask") ||
        !/Out/i.test(event.animationName)
      )
        return;
      w.motionProbe!.names.push(event.animationName);
      event.target.getAnimations().forEach((animation) => animation.pause());
    });
  });
  await close();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { motionProbe: { names: string[] } })
            .motionProbe.names.length,
      ),
    )
    .toBeGreaterThanOrEqual(2);
  await expect(page.locator(".ant-modal")).toHaveCount(1);
  expect(await page.locator(".ant-modal").innerText()).toBe(content);
  await page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.playState === "paused")
      .forEach((animation) => animation.finish()),
  );
  await expect(page.locator(".ant-modal:visible")).toHaveCount(0);
}
test("independent administration dialogs retain their panel, mask and content throughout exit", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "能力配置" }).click();
  await closeWithMotion(page, () =>
    page.getByRole("button", { name: "取消", exact: true }).click(),
  );
  await expect(page.getByRole("button", { name: "能力配置" })).toBeFocused();
  await page.getByRole("button", { name: "能力配置" }).click();
  await page.getByRole("switch", { name: "屏幕共享", exact: true }).click();
  await page.getByRole("textbox", { name: /修改原因/ }).fill("动画保存验证");
  await closeWithMotion(page, () =>
    page.getByRole("button", { name: "保存配置", exact: true }).click(),
  );
  await page.getByRole("tab", { name: "游戏联机", exact: true }).click();
  const gameRow = page.getByRole("row").filter({ hasText: game.name });
  for (const label of ["成员", "事件记录", "结束联机"]) {
    await gameRow.getByRole("button", { name: label, exact: true }).click();
    await closeWithMotion(page, () => page.keyboard.press("Escape"));
  }
  await page.getByRole("tab", { name: "房间管理" }).click();
  await page.getByRole("button", { name: "事件记录" }).click();
  await expect(page.getByRole("dialog")).toContainText("创建房间");
  await closeWithMotion(page, () =>
    page.locator(".ant-modal-wrap").click({ position: { x: 10, y: 10 } }),
  );
  await page.getByRole("tab", { name: "公告管理" }).click();
  await page.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "关闭期间必须保留这段公告内容",
  );
  await closeWithMotion(page, () =>
    page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .last()
      .click(),
  );
});
test("feature update prompt retains its issue until exit and supports reopening", async ({
  page,
}) => {
  await setup(page);
  for (let n = 0; n < 2; n++) {
    await page.evaluate(async () => {
      const modulePath = "/store.ts";
      const { update } = await import(modulePath);
      update({
        featureUpdate: {
          scope: "feature",
          feature: "game.minecraft-java",
          protocol: 2,
          reason: "关闭期间保留功能说明",
          updateKind: "desktop",
          minimumVersion: "0.1.35",
        },
      });
    });
    await closeWithMotion(page, () =>
      page.getByRole("button", { name: "暂不使用", exact: true }).click(),
    );
  }
});
test("game create and join panels keep their form fields and title during exit", async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(async () => {
    Object.assign(window, {
      desktop: {
        takeInvitation: async () => undefined,
        onAction: () => () => {},
        gameLink: { discover: async () => [], onConnection: () => () => {} },
      },
    });
    const modulePath = "/store.ts";
    const { useApp, update } = await import(modulePath);
    update({ user: { ...useApp.getState().user, gameHostEnabled: true } });
  });
  await page.goto("/#/games");
  await page.getByRole("button", { name: "发起联机", exact: true }).click();
  await expect(page.getByLabel("选择游戏")).toBeVisible();
  await closeWithMotion(page, () => page.keyboard.press("Escape"));
  await page.getByRole("button", { name: "输入联机码", exact: true }).click();
  await closeWithMotion(page, () => page.keyboard.press("Escape"));
});
test("a replacement feature prompt waits for the current exit and keeps the newest issue", async ({
  page,
}) => {
  await setup(page);
  const issue = async (reason: string) =>
    page.evaluate(async (value) => {
      const modulePath = "/store.ts";
      const { update } = await import(modulePath);
      update({
        featureUpdate: {
          scope: "feature",
          feature: "game.minecraft-java",
          protocol: 2,
          reason: value,
          updateKind: "desktop",
          minimumVersion: "0.1.35",
        },
      });
    }, reason);
  await issue("原提示内容");
  await expect(page.getByRole("dialog")).toContainText("原提示内容");
  await page.evaluate(() => {
    document.addEventListener("animationstart", (e) => {
      if (
        e.target instanceof Element &&
        e.target.matches(".ant-modal,.ant-modal-mask") &&
        /Out/i.test(e.animationName)
      )
        e.target.getAnimations().forEach((a) => a.pause());
    });
  });
  await page.getByRole("button", { name: "暂不使用", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((a) => a.playState === "paused")
            .length,
      ),
    )
    .toBeGreaterThanOrEqual(2);
  await issue("最新提示内容");
  await expect(page.locator(".ant-modal")).toContainText("原提示内容");
  await expect(page.locator(".ant-modal")).not.toContainText("最新提示内容");
  await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "paused")
      .forEach((a) => a.finish()),
  );
  await expect(page.getByRole("dialog")).toContainText("最新提示内容");
});

test("retained dialogs still clean up when reduced motion is requested", async ({
  page,
}) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "能力配置" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-modal:visible")).toHaveCount(0);
  await page.getByRole("button", { name: "能力配置" }).click();
  await expect(page.getByRole("dialog")).toContainText(user.displayName);
});

test("a created game closes its form with exit motion even when the local proxy fails", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    Object.assign(window, {
      desktop: {
        takeInvitation: async () => undefined,
        onAction: () => () => {},
        gameLink: {
          discover: async () => [
            { port: 25565, name: "本机 MC 世界", version: "1.21", protocol: 1 },
          ],
          probe: async (port: number) => ({
            port,
            name: "本机 MC 世界",
            version: "1.21",
            protocol: 1,
          }),
          configure: async () => {
            throw Error("游戏联机授权已失效或配置不匹配");
          },
          status: async () => ({ state: "failed", message: "本机连接未完成" }),
          stop: async () => {},
          onConnection: () => () => {},
        },
      },
    });
  });
  await setup(page);
  let created = false;
  const joined = {
    ...emptyGame,
    session: { ...game, status: "starting" },
    self: {
      memberId: id,
      revision: 1,
      role: "host",
      leaseExpiresAt: new Date(Date.now() + 30000).toISOString(),
    },
    members: [
      {
        id,
        userId: id,
        displayName: user.displayName,
        role: "host",
        status: "connecting",
        route: null,
      },
    ],
  };
  await page.route("**/api/v1/games**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/games" && route.request().method() === "POST")
      created = true;
    let body: unknown = created ? joined : emptyGame;
    if (path.endsWith("/transport"))
      body = {
        sessionId: id,
        memberId: id,
        clientId: id,
        clientSecret: "x".repeat(43),
        revision: 1,
        role: "host",
        expiresAt: new Date(Date.now() + 30000).toISOString(),
        peers: [],
        server: {
          host: "games.example.test",
          port: 443,
          tlsName: "games.example.test",
          stunServer: "games.example.test:3478",
          issuer: "https://api.example.test/api/v1/game-tunnel/identity",
          audience: "cinegather-game",
        },
      };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "X-CineGather-Server-Time": String(Date.now()) },
      body: JSON.stringify(body),
    });
  });
  await page.goto("/#/games");
  await page.getByRole("button", { name: "发起联机", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("本机 MC 世界");
  await page.evaluate(async () => {
    const modulePath = "/game-link.ts";
    const { gameLink } = await import(modulePath);
    await gameLink.scope("isolated-motion-fixture");
  });
  await closeWithMotion(page, () =>
    page
      .getByRole("dialog")
      .getByRole("button", { name: "发起联机", exact: true })
      .click(),
  );
  await expect(page.getByText("连接未就绪", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "选择世界并恢复" }),
  ).toBeVisible();
  await expect(
    page.getByText("联机已创建，但本机连接未就绪，请重新连接", { exact: true }),
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});
