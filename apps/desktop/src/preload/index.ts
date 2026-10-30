import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopBridge,
  MainWindowAction,
  MainWindowState,
} from "@cinegather/contracts";
const bridge: DesktopBridge = {
  notifications: {
    setDoNotDisturb: (enabled) =>
      ipcRenderer.invoke("desktop:do-not-disturb", enabled),
    onDoNotDisturb: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, enabled: boolean) =>
        callback(enabled);
      ipcRenderer.on("desktop:do-not-disturb-changed", listener);
      return () =>
        ipcRenderer.removeListener("desktop:do-not-disturb-changed", listener);
    },
    show: (input) => ipcRenderer.invoke("desktop:notification-show", input),
    clear: () => ipcRenderer.invoke("desktop:notification-clear"),
    unread: (count) => ipcRenderer.invoke("desktop:notification-unread", count),
    onActivate: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        id: string,
        scope: string,
      ) => callback(id, scope);
      ipcRenderer.on("desktop:notification-activate", listener);
      return () =>
        ipcRenderer.removeListener("desktop:notification-activate", listener);
    },
  },
  platform: process.platform,
  watchVisibility: {
    observe: (watching) =>
      ipcRenderer.invoke("desktop:watch-visibility", watching),
    onChange: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, visible: boolean) =>
        callback(visible);
      ipcRenderer.on("desktop:watch-visibility", listener);
      return () =>
        ipcRenderer.removeListener("desktop:watch-visibility", listener);
    },
  },
  viewingWindow: {
    action: (action) => ipcRenderer.invoke("desktop:viewing-action", action),
  },
  ...(process.platform === "win32"
    ? {
        windowControls: {
          state: () => ipcRenderer.invoke("desktop:window-state"),
          action: (action: MainWindowAction) =>
            ipcRenderer.invoke("desktop:window-action", action),
          onState: (callback: (state: MainWindowState) => void) => {
            const listener = (
              _event: Electron.IpcRendererEvent,
              state: MainWindowState,
            ) => callback(state);
            ipcRenderer.on("desktop:window-state", listener);
            return () =>
              ipcRenderer.removeListener("desktop:window-state", listener);
          },
        },
      }
    : {}),
  ...(["win32", "darwin"].includes(process.platform)
    ? {
        accompaniment: {
          sources: () => ipcRenderer.invoke("desktop:accompaniment-sources"),
          start: (sourceId: string, requestId: string) =>
            ipcRenderer.invoke("desktop:accompaniment-start", {
              sourceId,
              requestId,
            }),
          stop: (requestId: string) =>
            ipcRenderer.invoke("desktop:accompaniment-stop", requestId),
          acknowledge: (sessionId: string, sequence: number) =>
            ipcRenderer.send("desktop:accompaniment-ack", {
              sessionId,
              sequence,
            }),
          onData: (
            callback: (
              packet: import("@cinegather/contracts").ProcessAudioPacket,
            ) => void,
          ) => {
            const listener = (
              _event: Electron.IpcRendererEvent,
              packet: import("@cinegather/contracts").ProcessAudioPacket,
            ) => callback(packet);
            ipcRenderer.on("desktop:accompaniment-data", listener);
            return () =>
              ipcRenderer.removeListener(
                "desktop:accompaniment-data",
                listener,
              );
          },
          onError: (callback: (id: string, message: string) => void) => {
            const listener = (
              _event: Electron.IpcRendererEvent,
              id: string,
              message: string,
            ) => callback(id, message);
            ipcRenderer.on("desktop:accompaniment-error", listener);
            return () =>
              ipcRenderer.removeListener(
                "desktop:accompaniment-error",
                listener,
              );
          },
        },
      }
    : {}),
  diagnostics: {
    record: (entry) => ipcRenderer.invoke("desktop:diagnostic-record", entry),
    status: () => ipcRenderer.invoke("desktop:diagnostic-status"),
    nativeStatus: () => ipcRenderer.invoke("desktop:diagnostic-native"),
  },
  memberOverlay: {
    publish: (snapshot) =>
      ipcRenderer.invoke("desktop:overlay-state", snapshot),
  },
  ...(process.platform === "win32"
    ? {
        processAudio: {
          start: () => ipcRenderer.invoke("desktop:process-audio-start"),
          stop: () => ipcRenderer.invoke("desktop:process-audio-stop"),
          acknowledge: (sessionId: string, sequence: number) => {
            ipcRenderer.send("desktop:process-audio-ack", {
              sessionId,
              sequence,
            });
          },
          onData: (
            callback: (
              packet: import("@cinegather/contracts").ProcessAudioPacket,
            ) => void,
          ) => {
            const listener = (
              _event: Electron.IpcRendererEvent,
              packet: import("@cinegather/contracts").ProcessAudioPacket,
            ) => callback(packet);
            ipcRenderer.on("desktop:process-audio-data", listener);
            return () =>
              ipcRenderer.removeListener(
                "desktop:process-audio-data",
                listener,
              );
          },
          onError: (callback: (sessionId: string, message: string) => void) => {
            const listener = (
              _event: Electron.IpcRendererEvent,
              sessionId: string,
              message: string,
            ) => callback(sessionId, message);
            ipcRenderer.on("desktop:process-audio-error", listener);
            return () =>
              ipcRenderer.removeListener(
                "desktop:process-audio-error",
                listener,
              );
          },
        },
      }
    : {}),
  updates: {
    reconnect: () => ipcRenderer.invoke("desktop:update-reconnect"),
    requireUpdate: (minimumVersion, reason) =>
      ipcRenderer.invoke("desktop:update-require", { minimumVersion, reason }),
    quit: () => ipcRenderer.invoke("desktop:update-quit"),
    status: () => ipcRenderer.invoke("desktop:update-status"),
    check: () => ipcRenderer.invoke("desktop:update-check"),
    download: () => ipcRenderer.invoke("desktop:update-download"),
    install: () => ipcRenderer.invoke("desktop:update-install"),
    openDownload: () => ipcRenderer.invoke("desktop:update-open"),
    setInRoom: (active) => ipcRenderer.invoke("desktop:update-room", active),
    onChange: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        status: Parameters<typeof callback>[0],
      ) => callback(status);
      ipcRenderer.on("desktop:update-status", listener);
      return () =>
        ipcRenderer.removeListener("desktop:update-status", listener);
    },
  },
  nativeCapture: ["darwin", "win32"].includes(process.platform),
  encoders:
    process.platform === "win32"
      ? () => ipcRenderer.invoke("desktop:encoders")
      : undefined,
  startNativeCapture: (request) =>
    ipcRenderer.invoke("desktop:native-start", request),
  switchNativeSource: () => ipcRenderer.invoke("desktop:native-switch"),
  renewNativeCapture: (lease) =>
    ipcRenderer.invoke("desktop:native-renew", lease),
  stopNativeCapture: () => ipcRenderer.invoke("desktop:native-stop"),
  nativePreview: {
    start: (id) => ipcRenderer.invoke("desktop:preview-start", id),
    answer: (id, sdp) =>
      ipcRenderer.invoke("desktop:preview-answer", { id, sdp }),
    stop: (id) => ipcRenderer.invoke("desktop:preview-stop", id),
    foreground: () => ipcRenderer.invoke("desktop:foreground"),
    onForeground: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, active: boolean) =>
        callback(active);
      ipcRenderer.on("desktop:foreground", listener);
      return () => ipcRenderer.removeListener("desktop:foreground", listener);
    },
  },
  takeInvitation: () => ipcRenderer.invoke("desktop:take-invitation"),
  sources: () => ipcRenderer.invoke("desktop:sources"),
  sourceThumbnails: (ids) =>
    ipcRenderer.invoke("desktop:source-thumbnails", ids),
  selectSource: (selection) =>
    ipcRenderer.invoke("desktop:select-source", selection),
  cancelCapture: () => ipcRenderer.invoke("desktop:cancel-capture"),
  openExternal: (url) => ipcRenderer.invoke("desktop:external", url),
  loadSettings: () => ipcRenderer.invoke("desktop:settings-load"),
  hotkeyStatus: () => ipcRenderer.invoke("desktop:hotkey-status"),
  recordShortcut: () => ipcRenderer.invoke("desktop:shortcut-record"),
  cancelShortcutRecording: () => ipcRenderer.invoke("desktop:shortcut-cancel"),
  saveSettings: (settings) =>
    ipcRenderer.invoke("desktop:settings-save", settings),
  exportDiagnostics: (data) => ipcRenderer.invoke("desktop:diagnostics", data),
  setSharing: (active) => ipcRenderer.invoke("desktop:sharing", active),
  onAction: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      action: Parameters<typeof callback>[0],
      value?: string,
    ) => callback(action, value);
    ipcRenderer.on("desktop:action", listener);
    return () => {
      ipcRenderer.removeListener("desktop:action", listener);
    };
  },
};
contextBridge.exposeInMainWorld("desktop", bridge);
