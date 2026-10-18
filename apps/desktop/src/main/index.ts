import {
  app,
  BrowserWindow,
  protocol,
  net,
  ipcMain,
  desktopCapturer,
  session,
  shell,
  Tray,
  Menu,
  nativeImage,
  globalShortcut,
  dialog,
} from "electron";
import { join, resolve, sep } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { allowedExternal, trustedURL, permissionAllowed } from "./security";
import { defaultSettings, settingsSchema } from "./settings";
import { configureDisplayCapture } from "./capture";
import type { CaptureSelection, DesktopSettings } from "@cinegather/contracts";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;
let sharing = false;
let settings: DesktopSettings = defaultSettings;
let pending: (CaptureSelection & { expiresAt: number }) | undefined;
const devURL = process.env.ELECTRON_RENDERER_URL;
let pendingInvite: string | undefined = process.argv.find(
  (value) => value.startsWith("cinegather://") && value.length <= 4096,
);
const sendAction = (action: string, value?: string) =>
  win?.webContents.send("desktop:action", action, value);
const settingsPath = () => join(app.getPath("userData"), "settings.json");
function shortcuts(next: DesktopSettings) {
  globalShortcut.unregisterAll();
  if (
    !globalShortcut.register(next.muteShortcut, () => sendAction("toggle-mute"))
  )
    throw new Error("麦克风快捷键被占用");
  if (
    next.pushToTalk &&
    !globalShortcut.register(next.pttShortcut, () => sendAction("ptt-toggle"))
  )
    throw new Error("按键说话快捷键被占用");
}
function showWindow() {
  win?.show();
  win?.focus();
}
function updateTray() {
  tray?.setToolTip(sharing ? "映聚 · 正在共享屏幕" : "映聚 CineGather");
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: sharing ? "正在共享 · 打开映聚" : "打开映聚",
        click: showWindow,
      },
      { label: "麦克风静音 / 开启", click: () => sendAction("toggle-mute") },
      ...(sharing
        ? [{ label: "停止共享", click: () => sendAction("stop-share") }]
        : []),
      { type: "separator" as const },
      {
        label: "退出映聚",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}
async function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#0d0f14",
    title: "映聚 CineGather",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (allowedExternal(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!trustedURL(url, devURL)) event.preventDefault();
  });
  win.on("close", (event) => {
    if (!quitting && settings.minimizeToTray) {
      event.preventDefault();
      win?.hide();
    }
  });
  win.webContents.on("render-process-gone", () => {
    pending = undefined;
    sharing = false;
    updateTray();
  });
  if (devURL) await win.loadURL(devURL);
  else await win.loadURL("app://cinegather/index.html");
}
function registerIPC() {
  function handle(name: string, run: (input: unknown) => unknown) {
    ipcMain.handle(name, (event, input: unknown) => {
      if (
        !win ||
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame ||
        !trustedURL(event.senderFrame.url, devURL)
      )
        throw new Error("不受信任的 IPC 调用");
      return run(input);
    });
  }
  handle("desktop:take-invitation", () => {
    const value = pendingInvite;
    pendingInvite = undefined;
    return value;
  });
  handle("desktop:sources", async () =>
    (
      await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 400, height: 225 },
        fetchWindowIcons: false,
      })
    )
      .filter((source) => source.id !== win?.getMediaSourceId())
      .map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        kind: source.id.startsWith("screen:") ? "screen" : "window",
      })),
  );
  handle("desktop:select-source", async (input) => {
    const choice = z
      .strictObject({ sourceId: z.string().max(256), systemAudio: z.boolean() })
      .parse(input);
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 0, height: 0 },
    });
    if (!sources.some((s) => s.id === choice.sourceId))
      throw new Error("共享来源已消失，请重新选择");
    pending = { ...choice, expiresAt: Date.now() + 20_000 };
  });
  handle("desktop:cancel-capture", () => {
    pending = undefined;
  });
  handle("desktop:external", async (input) => {
    const url = z.string().max(4096).parse(input);
    if (!allowedExternal(url)) throw new Error("只允许打开网页链接");
    await shell.openExternal(url);
  });
  handle("desktop:settings-load", () => settings);
  handle("desktop:settings-save", async (input) => {
    const next = settingsSchema.parse(input);
    try {
      shortcuts(next);
    } catch (error) {
      shortcuts(settings);
      throw error;
    }
    await writeFile(settingsPath(), JSON.stringify(next), { mode: 0o600 });
    settings = next;
  });
  handle("desktop:sharing", (input) => {
    sharing = z.boolean().parse(input);
    updateTray();
    win?.setTitle(sharing ? "正在共享 · 映聚 CineGather" : "映聚 CineGather");
  });
  handle("desktop:diagnostics", async (input) => {
    // Whitelist renderer exports: never write tokens, invitations, IP addresses or raw media.
    const data = z
      .object({
        capturedAt: z.string().optional(),
        state: z.string().optional(),
        watching: z.boolean().optional(),
        tracks: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
      })
      .parse(input);
    const safeTracks = data.tracks?.map((track) =>
      Object.fromEntries(
        Object.entries(track).filter(([k]) =>
          [
            "type",
            "source",
            "local",
            "kind",
            "bytesReceived",
            "bytesSent",
            "packetsLost",
            "jitter",
            "framesPerSecond",
            "framesDecoded",
            "framesDropped",
            "frameWidth",
            "frameHeight",
            "currentRoundTripTime",
            "availableOutgoingBitrate",
            "mimeType",
            "state",
            "nominated",
            "nackCount",
            "retransmittedPacketsSent",
            "localCandidateType",
            "remoteCandidateType",
            "transportProtocol",
          ].includes(k),
        ),
      ),
    );
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: `cinegather-diagnostics-${Date.now()}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(
      result.filePath,
      JSON.stringify(
        {
          ...data,
          tracks: safeTracks,
          appVersion: app.getVersion(),
          platform: process.platform,
          versions: {
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node,
          },
          process: { memory: process.memoryUsage(), cpu: process.cpuUsage() },
          gpu: app.getGPUFeatureStatus(),
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    return true;
  });
}
function capturePermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler(
    (webContents, permission, callback, details) =>
      callback(
        Boolean(
          win &&
            webContents === win.webContents &&
            details.isMainFrame &&
            trustedURL(details.requestingUrl, devURL) &&
            permissionAllowed(
              permission,
              "mediaTypes" in details ? details.mediaTypes : undefined,
              Boolean(pending && pending.expiresAt > Date.now()),
            ),
        ),
      ),
  );
  ses.setPermissionCheckHandler((webContents, permission, origin, details) =>
    Boolean(
      win &&
        webContents === win.webContents &&
        details.isMainFrame &&
        trustedURL(origin, devURL) &&
        permissionAllowed(
          permission,
          details.mediaType ? [details.mediaType] : undefined,
        ),
    ),
  );
  configureDisplayCapture(ses, {
    takeSelection: () => {
      const choice = pending;
      pending = undefined;
      return choice;
    },
    isTrustedRequest: (request) =>
      Boolean(
        win &&
          request.frame === win.webContents.mainFrame &&
          trustedURL(request.securityOrigin, devURL),
      ),
    getSources: () =>
      desktopCapturer.getSources({ types: ["screen", "window"] }),
    platform: process.platform,
  });
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    const invite = argv.find((v) => v.startsWith("cinegather://"));
    if (invite && invite.length <= 4096) {
      pendingInvite = invite;
      sendAction("invite", invite);
    }
    showWindow();
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (url.startsWith("cinegather://") && url.length <= 4096) {
      pendingInvite = url;
      if (win) sendAction("invite", url);
    }
  });
  app.on("before-quit", () => {
    quitting = true;
  });
  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });
  app
    .whenReady()
    .then(async () => {
      await mkdir(app.getPath("userData"), { recursive: true });
      try {
        settings = settingsSchema.parse(
          JSON.parse(await readFile(settingsPath(), "utf8")),
        );
      } catch {
        settings = defaultSettings;
      }
      const root = resolve(__dirname, "../renderer");
      protocol.handle("app", (request) => {
        const url = new URL(request.url);
        const path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (
          url.hostname !== "cinegather" ||
          (!path.startsWith(root + sep) && path !== root)
        )
          return new Response("Forbidden", { status: 403 });
        return net.fetch(pathToFileURL(path).toString());
      });
      registerIPC();
      capturePermissions();
      const icon = nativeImage.createFromPath(
        join(__dirname, "../../resources/tray.png"),
      );
      icon.setTemplateImage(process.platform === "darwin");
      tray = new Tray(icon);
      updateTray();
      tray.on("click", showWindow);
      try {
        shortcuts(settings);
      } catch {
        /* Settings UI reports shortcut registration on save. */
      }
      app.setAsDefaultProtocolClient("cinegather");
      await createWindow();
      app.on("activate", showWindow);
    })
    .catch((error) => {
      console.error(
        "Desktop initialization failed:",
        error instanceof Error ? error.message : "Unknown",
      );
      app.quit();
    });
}
