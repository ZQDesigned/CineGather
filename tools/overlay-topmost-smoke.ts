import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

if (process.platform !== "win32") throw new Error("Run on Windows");
await mkdir(".local", { recursive: true });
const directory = await mkdtemp(resolve(".local/overlay-z-order-"));
const server = createServer((_req, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    '<html><body style="margin:0;background:#16733b;color:white">Overlay fixture</body></html>',
  );
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
if (!address || typeof address === "string")
  throw Error("Fixture server unavailable");
for (const [entry, target] of [
  ["apps/desktop/src/main/member-overlay.ts", "main/overlay.cjs"],
  ["apps/desktop/src/preload/member-overlay.ts", "preload/member-overlay.cjs"],
] as const) {
  const output = join(directory, target);
  const build = await Bun.build({
    entrypoints: [entry],
    target: "node",
    format: "cjs",
    external: ["electron"],
  });
  if (!build.success)
    throw new AggregateError(build.logs, "Overlay fixture build failed");
  await mkdir(join(directory, target.split("/")[0]!), { recursive: true });
  await writeFile(output, await build.outputs[0]!.text());
}
await writeFile(
  join(directory, "main/fixture.cjs"),
  String.raw`
const {app,BrowserWindow,screen}=require('electron');
const {MemberOverlay}=require('./overlay.cjs');
const ffi=require('koffi'),user32=ffi.load('user32.dll');
const position=user32.func('int __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int width, int height, uint32_t flags)');
const style=user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)');
const next=user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32_t command)');
const foreground=user32.func('intptr_t __stdcall GetForegroundWindow()');
function handle(w){const b=w.getNativeWindowHandle();return b.length===8?b.readBigInt64LE():BigInt(b.readInt32LE());}
function above(a,b){for(let w=BigInt(next(a,2)),i=0;w&&i<2000;w=BigInt(next(w,2)),i++)if(w===b)return true;return false;}
app.whenReady().then(async()=>{
 const main=new BrowserWindow({width:600,height:400,show:true});await main.loadURL('data:text/html,Main fixture');
 const overlay=new MemberOverlay(()=>main,'http://127.0.0.1:${address.port}/');
 const snapshot={roomId:'fixture',roomName:'fixture',members:[{id:'fixture',name:'fixture',local:true,owner:true,microphone:false,speaking:false,sharing:false}]};
 overlay.publish(snapshot);
 const cover=new BrowserWindow({width:600,height:400,frame:false,show:false});await cover.loadURL('data:text/html,<body style="background:%23a82929">Cover fixture');
 function window(){const w=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='映聚成员浮层');if(!w)throw Error('Overlay not created');return w;}
 function state(){const w=window(),hwnd=handle(w),ex=BigInt(style(hwnd,-20));return {topmost:!!(ex&8n),aboveCover:above(hwnd,handle(cover)),foregroundRetained:BigInt(foreground())===handle(cover),visible:w.isVisible(),focusable:w.isFocusable(),clickThrough:!!(ex&32n),capturable:!w.isContentProtected(),cachedTopmost:w.isAlwaysOnTop(),coverFullscreen:cover.isFullScreen()};}
 globalThis.overlayTest={state,
  async cover(fullscreen){cover.setBounds(screen.getPrimaryDisplay().bounds);cover.setAlwaysOnTop(true,'screen-saver');cover.show();cover.focus();if(fullscreen&&!cover.isFullScreen())await new Promise(done=>{cover.once('enter-full-screen',done);cover.setFullScreen(true);});position(handle(cover),-1n,0,0,0,0,0x213);return state();},
  demote(){position(handle(window()),-2n,0,0,0,0,0x213);return state();},
  block(value){overlay.block(value);},
  hideMain(){main.hide();},
  clear(){overlay.publish(null);},
  restore(){overlay.publish(snapshot);},
  destroy(){overlay.destroy();},
  legacy(){const w=new BrowserWindow({width:256,height:80,show:false,frame:false,focusable:false,transparent:true});w.setAlwaysOnTop(true,'floating');w.showInactive();position(handle(w),-2n,0,0,0,0,0x213);const result={cached:w.isAlwaysOnTop(),native:!!(BigInt(style(handle(w),-20))&8n)};w.destroy();return result;}
 };
 app.on('before-quit',()=>overlay.destroy());
});
`,
);
interface OverlayState {
  topmost: boolean;
  aboveCover: boolean;
  foregroundRetained: boolean;
  visible: boolean;
  focusable: boolean;
  clickThrough: boolean;
  capturable: boolean;
  cachedTopmost: boolean;
  coverFullscreen: boolean;
}
interface Harness {
  state(): OverlayState;
  cover(fullscreen: boolean): Promise<OverlayState>;
  demote(): OverlayState;
  block(value: boolean): void;
  hideMain(): void;
  clear(): void;
  restore(): void;
  destroy(): void;
  legacy(): { cached: boolean; native: boolean };
}
const app = await electron.launch({
  args: [
    join(directory, "main/fixture.cjs"),
    `--user-data-dir=${join(directory, "profile")}`,
  ],
});
const read = () =>
  app.evaluate(() =>
    (globalThis as unknown as { overlayTest: Harness }).overlayTest.state(),
  );
try {
  await expect
    .poll(() =>
      app.evaluate(() =>
        Boolean(
          (globalThis as unknown as { overlayTest?: Harness }).overlayTest,
        ),
      ),
    )
    .toBe(true);
  await expect.poll(read).toMatchObject({
    topmost: true,
    visible: true,
    focusable: false,
    clickThrough: true,
    capturable: true,
  });
  // Reproduce native topmost loss independently of Electron's reported flag.
  expect(
    await app.evaluate(() =>
      (globalThis as unknown as { overlayTest: Harness }).overlayTest.legacy(),
    ),
  ).toMatchObject({ native: false });
  await app.evaluate(() =>
    (globalThis as unknown as { overlayTest: Harness }).overlayTest.cover(
      false,
    ),
  );
  await expect.poll(read, { timeout: 4000 }).toMatchObject({
    topmost: true,
    aboveCover: true,
    foregroundRetained: true,
  });
  const demoted = await app.evaluate(() =>
    (globalThis as unknown as { overlayTest: Harness }).overlayTest.demote(),
  );
  expect(demoted).toMatchObject({ topmost: false });
  await expect.poll(read, { timeout: 4000 }).toMatchObject({
    topmost: true,
    aboveCover: true,
    foregroundRetained: true,
  });
  await app.evaluate(() =>
    (globalThis as unknown as { overlayTest: Harness }).overlayTest.cover(true),
  );
  await expect.poll(read, { timeout: 4000 }).toMatchObject({
    coverFullscreen: true,
    topmost: true,
    aboveCover: true,
    foregroundRetained: true,
  });
  await app.evaluate(() =>
    (globalThis as unknown as { overlayTest: Harness }).overlayTest.hideMain(),
  );
  await expect.poll(read).toMatchObject({
    visible: true,
    aboveCover: true,
    foregroundRetained: true,
  });
  await app.evaluate(() =>
    (globalThis as unknown as { overlayTest: Harness }).overlayTest.block(true),
  );
  await new Promise((r) => setTimeout(r, 1250));
  expect(await read()).toMatchObject({
    visible: false,
    foregroundRetained: true,
  });
  await app.evaluate(() =>
    (globalThis as unknown as { overlayTest: Harness }).overlayTest.block(
      false,
    ),
  );
  await expect.poll(read, { timeout: 4000 }).toMatchObject({
    visible: true,
    topmost: true,
    aboveCover: true,
    foregroundRetained: true,
    clickThrough: true,
    capturable: true,
  });
  await app.evaluate(() =>
    (globalThis as unknown as { overlayTest: Harness }).overlayTest.clear(),
  );
  await new Promise((r) => setTimeout(r, 1250));
  expect(await read()).toMatchObject({
    visible: false,
    foregroundRetained: true,
  });
  console.log(
    JSON.stringify({
      windowsNativeOverlay: true,
      nativeTopmostLossReproduced: true,
      electronFlagAfterDemotion: demoted.cachedTopmost,
      actualNativeDemotionRecovered: true,
      laterTopmostWindowRecovered: true,
      borderlessFullscreenRecovered: true,
      noFocusSteal: true,
      clickThrough: true,
      capturable: true,
      hiddenOverlayNotResurrected: true,
    }),
  );
} catch (error) {
  console.error(
    "Native overlay state at failure:",
    await read().catch(() => undefined),
  );
  throw error;
} finally {
  await app.close();
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done())),
  );
  await rm(directory, { recursive: true, force: true });
}
