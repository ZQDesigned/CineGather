import { app, BrowserWindow } from "electron";
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    title: "CG System Audio Controlled Source",
    x: 12,
    y: 48,
    width: 920,
    height: 565,
    alwaysOnTop: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><title>CG System Audio Controlled Source</title><style>html,body{margin:0;background:#172f48}canvas{width:100vw;height:100vh}</style><canvas width="1280" height="720"></canvas>')}`,
  );
  window.show();
});
app.on("window-all-closed", () => app.quit());
