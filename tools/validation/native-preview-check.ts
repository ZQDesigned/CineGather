import { _electron as electron } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativePreviewSmoke } from "./native-preview-smoke";

// Fail the native transport regression before spending time building NSIS.
const directory = await mkdtemp(join(tmpdir(), "cg-native-preview-check-"));
let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
try {
  const entry = join(directory, "main.cjs");
  await writeFile(
    entry,
    `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const w=new BrowserWindow({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.loadURL('data:text/html,<title>Native preview transport regression</title>');});`,
  );
  const run = async (loopback: boolean) => {
    app = await electron.launch({
      args: [
        entry,
        `--user-data-dir=${join(directory, "profile")}`,
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        ...(loopback ? ["--allow-loopback-in-peer-connection"] : []),
      ],
    });
    try {
      await nativePreviewSmoke(
        await app.firstWindow(),
        ".local/native-runtime/windows/build/CGStreamPreviewSmoke.exe",
        ".local/native-runtime/windows/obs",
        ".local/pion-whip-smoke.exe",
      );
    } finally {
      await app.close();
      app = undefined;
    }
  };
  if (process.argv.includes("--probe-default")) {
    try {
      await run(false);
    } catch {
      console.log(
        "Default interface enumeration could not receive the loopback preview; testing explicit loopback enumeration.",
      );
    }
  }
  await run(true);
} finally {
  if (app) await app.close();
  await rm(directory, { recursive: true, force: true });
}
