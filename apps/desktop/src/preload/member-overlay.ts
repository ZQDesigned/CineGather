import { contextBridge, ipcRenderer } from "electron";
import type {
  MemberOverlayBridge,
  MemberOverlayView,
} from "@cinegather/contracts";
const bridge: MemberOverlayBridge = {
  state: () => ipcRenderer.invoke("overlay:state"),
  onChange: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      view: MemberOverlayView,
    ) => callback(view);
    ipcRenderer.on("overlay:changed", listener);
    return () => ipcRenderer.removeListener("overlay:changed", listener);
  },
};
contextBridge.exposeInMainWorld("memberOverlay", bridge);
