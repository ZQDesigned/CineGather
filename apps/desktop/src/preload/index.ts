import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "@cinegather/contracts";
const bridge: DesktopBridge = {
  platform: process.platform,
  nativeCapture: process.platform === "darwin",
  startNativeCapture: (request) =>
    ipcRenderer.invoke("desktop:native-start", request),
  renewNativeCapture: (lease) =>
    ipcRenderer.invoke("desktop:native-renew", lease),
  stopNativeCapture: () => ipcRenderer.invoke("desktop:native-stop"),
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
