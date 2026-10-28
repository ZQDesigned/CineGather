import { contextBridge, ipcRenderer } from "electron";
import type { DesktopNotification } from "@cinegather/contracts";
contextBridge.exposeInMainWorld("notificationCard", {
  state: () => ipcRenderer.invoke("notification-card:state"),
  close: () => ipcRenderer.invoke("notification-card:close"),
  activate: () => ipcRenderer.invoke("notification-card:activate"),
  onChange: (callback: (value?: DesktopNotification) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      value?: DesktopNotification,
    ) => callback(value);
    ipcRenderer.on("notification-card:changed", listener);
    return () =>
      ipcRenderer.removeListener("notification-card:changed", listener);
  },
});
