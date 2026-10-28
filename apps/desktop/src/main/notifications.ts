import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  Notification,
  screen,
  session,
} from "electron";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  defaultNotificationPreferences,
  type DesktopNotification,
  type DesktopSettings,
} from "@cinegather/contracts";
import { trustedURL } from "./security";
import { execFile } from "node:child_process";
import { shouldFallbackNotification } from "../shared/notification-permission";

export class DesktopNotifications {
  private signature =
    process.platform === "darwin"
      ? new Promise<boolean>((done) =>
          execFile(
            "/usr/bin/codesign",
            ["--verify", "--strict", resolve(process.execPath, "../../..")],
            { timeout: 2000 },
            (error) => done(!error),
          ),
        )
      : Promise.resolve(true);
  private notices = new Map<string, Notification>();
  private card?: BrowserWindow;
  private current?: DesktopNotification;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private disposed = false;
  private sessionReady = false;
  constructor(
    private deps: {
      main(): BrowserWindow | undefined;
      settings(): DesktopSettings;
      sharing(): boolean;
      activate(id: string, scope: string): void;
      devURL?: string;
    },
  ) {
    for (const [channel, run] of [
      ["notification-card:state", () => this.current],
      ["notification-card:close", () => this.hideCard()],
      [
        "notification-card:activate",
        () => {
          const item = this.current;
          this.hideCard();
          if (item) this.deps.activate(item.id, item.scope);
        },
      ],
    ] as const)
      ipcMain.handle(channel, (event) => {
        if (
          !this.card ||
          event.sender !== this.card.webContents ||
          event.senderFrame !== this.card.webContents.mainFrame ||
          !trustedURL(event.senderFrame.url, deps.devURL)
        )
          throw Error("不受信任的通知调用");
        return run();
      });
  }
  show(input: DesktopNotification) {
    const preferences =
      this.deps.settings().notifications ?? defaultNotificationPreferences;
    if (
      this.disposed ||
      !preferences.enabled ||
      !preferences.desktop ||
      preferences.doNotDisturb
    )
      return;
    const main = this.deps.main();
    if (!main || main.isDestroyed() || main.isFocused()) return;
    const item =
      this.deps.sharing() || !preferences.preview
        ? { ...input, title: "映聚", body: "收到一条新提醒" }
        : input;
    main.flashFrame(true);
    const generation = this.generation;
    const fallback = async (error = "") => {
      const signed = await this.signature;
      if (
        generation !== this.generation ||
        this.disposed ||
        !shouldFallbackNotification(process.platform, signed, error)
      )
        return;
      await this.showCard(item).catch(() => {});
    };
    if (!Notification.isSupported()) return fallback();
    try {
      this.notices.get(item.id)?.close();
      const notification = new Notification({
        title: item.title,
        body: item.body,
        silent: true,
      });
      this.notices.set(item.id, notification);
      while (this.notices.size > 20) {
        const id = this.notices.keys().next().value!;
        this.notices.get(id)?.close();
        this.notices.delete(id);
      }
      notification.once("click", () => {
        if (generation === this.generation)
          this.deps.activate(item.id, item.scope);
      });
      notification.once("failed", (_event, error) => fallback(error));
      notification.once("close", () => {
        if (this.notices.get(item.id) === notification)
          this.notices.delete(item.id);
      });
      notification.show();
    } catch {
      fallback();
    }
  }
  hideForForeground() {
    ++this.generation;
    for (const notice of this.notices.values()) notice.close();
    this.notices.clear();
    this.hideCard();
  }
  unread(count: number) {
    if (!this.disposed) app.setBadgeCount(count);
  }
  clear() {
    ++this.generation;
    for (const notice of this.notices.values()) notice.close();
    this.notices.clear();
    this.hideCard();
    const main = this.deps.main();
    if (main && !main.isDestroyed()) main.flashFrame(false);
  }
  closeSurface() {
    this.clear();
    if (this.card && !this.card.isDestroyed()) this.card.destroy();
  }
  private hideCard() {
    clearTimeout(this.timer);
    this.current = undefined;
    if (this.card && !this.card.isDestroyed()) this.card.hide();
  }
  private async showCard(item: DesktopNotification) {
    const generation = this.generation;
    this.current = item;
    if (!this.card || this.card.isDestroyed()) {
      const ses = session.fromPartition("notification-card");
      ses.setPermissionRequestHandler((_contents, _permission, reply) =>
        reply(false),
      );
      ses.setPermissionCheckHandler(() => false);
      ses.setDisplayMediaRequestHandler((_request, reply) => reply(null));
      if (!this.sessionReady) {
        const root = resolve(__dirname, "../renderer");
        ses.protocol.handle("app", (request) => {
          const url = new URL(request.url),
            path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
          if (url.hostname !== "cinegather" || !path.startsWith(root + sep))
            return new Response("Forbidden", { status: 403 });
          return net.fetch(pathToFileURL(path).toString());
        });
        this.sessionReady = true;
      }
      ses.webRequest.onBeforeRequest((details, reply) => {
        const url = new URL(details.url),
          dev = this.deps.devURL && new URL(this.deps.devURL);
        reply({
          cancel:
            !(url.protocol === "app:" && url.hostname === "cinegather") &&
            !(
              dev &&
              url.host === dev.host &&
              ["http:", "https:", "ws:", "wss:"].includes(url.protocol)
            ),
        });
      });
      const card = new BrowserWindow({
        width: 360,
        height: 160,
        frame: false,
        show: false,
        focusable: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        backgroundColor: "#191b24",
        title: "映聚通知",
        skipTaskbar: process.platform === "win32",
        ...(process.platform === "darwin" ? { type: "panel" } : {}),
        webPreferences: {
          session: ses,
          preload: join(__dirname, "../preload/notification-card.cjs"),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
          webSecurity: true,
        },
      });
      this.card = card;
      card.setAlwaysOnTop(true, "screen-saver");
      if (process.platform === "darwin")
        card.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
          skipTransformProcessType: true,
        });
      card.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      card.webContents.on("will-navigate", (event) => event.preventDefault());
      card.webContents.on("render-process-gone", () => card.destroy());
      card.on("closed", () => {
        if (this.card === card) this.card = undefined;
      });
      await card.loadURL(this.deps.devURL || "app://cinegather/index.html");
    }
    if (
      generation !== this.generation ||
      !this.current ||
      this.card.isDestroyed()
    )
      return;
    if (this.deps.main()?.isFocused()) return this.hideCard();
    const area = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    ).workArea;
    this.card.setPosition(
      area.x + area.width - 376,
      area.y + area.height - 176,
    );
    this.card.webContents.send("notification-card:changed", this.current);
    this.card.showInactive();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hideCard(), 8000);
  }
  destroy() {
    if (this.disposed) return;
    this.closeSurface();
    this.disposed = true;
    app.setBadgeCount(0);
    for (const name of ["state", "close", "activate"])
      ipcMain.removeHandler("notification-card:" + name);
  }
}
