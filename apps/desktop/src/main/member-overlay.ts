import { app, BrowserWindow, ipcMain, net, screen, session } from "electron";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  MemberOverlayPreferences,
  MemberOverlaySnapshot,
  MemberOverlayView,
} from "@cinegather/contracts";
import { defaultOverlayPreferences } from "../shared/settings";
import { overlayBounds } from "../shared/member-overlay";
import { trustedURL } from "./security";

export class MemberOverlay {
  private window?: BrowserWindow;
  private snapshot: MemberOverlaySnapshot | null = null;
  private preferences = defaultOverlayPreferences;
  private blocked = false;
  private ready = false;
  private disposed = false;
  private sessionConfigured = false;
  private displayChanged = () => this.refresh();
  constructor(
    private mainWindow: () => BrowserWindow | undefined,
    private devURL?: string,
  ) {
    screen.on("display-added", this.displayChanged);
    screen.on("display-removed", this.displayChanged);
    screen.on("display-metrics-changed", this.displayChanged);
    ipcMain.handle("overlay:state", (event) => {
      if (
        !this.window ||
        event.sender !== this.window.webContents ||
        event.senderFrame !== this.window.webContents.mainFrame ||
        !trustedURL(event.senderFrame.url, this.devURL)
      )
        throw new Error("不受信任的浮层调用");
      return this.view();
    });
  }
  private view(): MemberOverlayView {
    return {
      snapshot: this.snapshot,
      backgroundOpacity: this.preferences.opacity,
    };
  }
  publish(snapshot: MemberOverlaySnapshot | null) {
    this.snapshot = snapshot;
    this.refresh();
  }
  configure(preferences: MemberOverlayPreferences = defaultOverlayPreferences) {
    this.preferences = preferences;
    this.refresh();
  }
  block(blocked: boolean) {
    this.blocked = blocked;
    this.refresh();
  }
  relayout() {
    this.refresh();
  }
  sourceId() {
    return this.window && !this.window.isDestroyed()
      ? this.window.getMediaSourceId()
      : undefined;
  }
  private create() {
    const ses = session.fromPartition("member-overlay");
    ses.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    ses.setPermissionCheckHandler(() => false);
    ses.setDisplayMediaRequestHandler((_request, callback) => callback(null));
    const root = resolve(__dirname, "../renderer");
    if (!this.sessionConfigured)
      ses.protocol.handle("app", (request) => {
        const url = new URL(request.url);
        const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (
          url.hostname !== "cinegather" ||
          (!path.startsWith(root + sep) && path !== root)
        )
          return new Response("Forbidden", { status: 403 });
        return net.fetch(pathToFileURL(path).toString());
      });
    this.sessionConfigured = true;
    ses.webRequest.onBeforeRequest((details, callback) => {
      let allowed = details.url.startsWith("app://cinegather/");
      if (this.devURL) {
        const url = new URL(details.url),
          dev = new URL(this.devURL);
        allowed ||=
          url.host === dev.host &&
          ["http:", "https:", "ws:", "wss:"].includes(url.protocol);
      }
      callback({ cancel: !allowed });
    });
    const w = new BrowserWindow({
      width: 256,
      height: 80,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: false,
      resizable: false,
      movable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: process.platform === "win32",
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      title: "映聚成员浮层",
      webPreferences: {
        session: ses,
        preload: join(__dirname, "../preload/member-overlay.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false,
        devTools: !app.isPackaged,
      },
    });
    this.window = w;
    this.ready = false;
    w.setAlwaysOnTop(true, "floating");
    w.setIgnoreMouseEvents(true);
    if (process.platform === "darwin")
      // Panels can float over fullscreen apps without hiding the entire app's Dock icon.
      w.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
    if (process.platform === "win32") w.setContentProtection(true);
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.webContents.on("will-navigate", (event) => event.preventDefault());
    w.on("page-title-updated", (event) => event.preventDefault());
    w.webContents.on("render-process-gone", () => {
      this.ready = false;
      w.destroy();
    });
    w.once("ready-to-show", () => {
      if (this.window === w) {
        this.ready = true;
        this.refresh();
      }
    });
    w.on("closed", () => {
      if (this.window === w) {
        this.window = undefined;
        this.ready = false;
      }
    });
    void w.loadURL(this.devURL || "app://cinegather/index.html").catch(() => {
      this.ready = false;
      if (!w.isDestroyed()) w.hide();
    });
  }
  private refresh() {
    if (this.disposed) return;
    const visible = Boolean(
      this.snapshot && this.preferences.enabled && !this.blocked,
    );
    if (!visible) {
      if (this.window && !this.window.isDestroyed()) {
        this.window.hide();
        if (this.ready)
          this.window.webContents.send("overlay:changed", this.view());
      }
      return;
    }
    if (!this.window || this.window.isDestroyed()) this.create();
    const w = this.window!;
    const main = this.mainWindow();
    const preferred =
      main && !main.isDestroyed()
        ? screen.getDisplayMatching(main.getBounds())
        : screen.getPrimaryDisplay();
    const bounds = overlayBounds(
      this.preferences.position,
      this.snapshot!.members.length,
      preferred.workArea,
    );
    const old = w.getBounds();
    if (
      Object.keys(bounds).some(
        (k) =>
          bounds[k as keyof typeof bounds] !== old[k as keyof typeof bounds],
      )
    )
      w.setBounds(bounds);
    if (this.ready) {
      w.webContents.send("overlay:changed", this.view());
      if (!w.isVisible()) w.showInactive();
    }
  }
  destroy() {
    this.disposed = true;
    screen.removeListener("display-added", this.displayChanged);
    screen.removeListener("display-removed", this.displayChanged);
    screen.removeListener("display-metrics-changed", this.displayChanged);
    this.window?.destroy();
    this.window = undefined;
  }
}
