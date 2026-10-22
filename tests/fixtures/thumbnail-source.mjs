import { app, BrowserWindow } from "electron";
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 960,
    height: 540,
    title: "CG Thumbnail Test Window",
    backgroundColor: "#1677ff",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><title>CG Thumbnail Test Window</title><style>html,body{margin:0;width:100%;height:100%;background:#1677ff;color:white;font:48px system-ui}body{display:grid;place-items:center}small{position:absolute;bottom:30px;font-size:18px}</style><strong>CG · PREVIEW A</strong><small>Controlled local capture fixture</small>`)}`,
  );
  window.show();
});
app.on("window-all-closed", () => app.quit());
