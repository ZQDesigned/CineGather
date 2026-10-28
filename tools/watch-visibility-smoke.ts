import { _electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
const directory = await mkdtemp(resolve(".local/window-visibility-"));
const entry = join(directory, "fixture.ts");
await writeFile(
  entry,
  `
import {app,BrowserWindow,screen} from 'electron';
import {WindowVisibilityMonitor} from ${JSON.stringify(resolve("apps/desktop/src/main/watch-visibility.ts"))};
import {nativeWindowVisibility} from ${JSON.stringify(resolve("apps/desktop/src/main/native-window-visibility.ts"))};
app.whenReady().then(async()=>{
 const area=screen.getPrimaryDisplay().workArea;
 const bounds={x:area.x+40,y:area.y+40,width:800,height:560};
 const make=async(title,bg)=>{const w=new BrowserWindow({...bounds,show:false,frame:false,backgroundColor:bg,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});await w.loadURL('data:text/html,<title>'+title+'</title><body style="margin:0;background:'+bg+'">'+title);w.setTitle(title);return w};
 const main=await make('Visibility main','#102a50');main.show();main.focus();
 let child,blocked=false;const changes=[];
 const probe=nativeWindowVisibility(process.platform);
 const monitor=new WindowVisibilityMonitor({windows:()=>[main,child].filter(Boolean),blocked:()=>blocked,probe,changed:value=>changes.push(value)});
 const cover=await make('Visibility opaque cover','#802030');
 cover.setAlwaysOnTop(true,'screen-saver');
 const second=await make('Visibility second cover','#206030');second.setAlwaysOnTop(true,'screen-saver');
 globalThis.visibilityFixture={
  read(){return{visible:monitor.sync(),changes:[...changes],mainFocused:main.isFocused(),mainShown:main.isVisible(),mainMinimized:main.isMinimized()}},
  watch(value){return monitor.watch(value)},
  async mode(mode){
   if(mode==='full'){cover.setOpacity(1);cover.setBounds({x:bounds.x-30,y:bounds.y-30,width:bounds.width+60,height:bounds.height+60});cover.show();cover.focus();}
   if(mode==='partial'){cover.setOpacity(1);cover.setBounds({x:bounds.x+bounds.width/2,y:bounds.y-30,width:bounds.width,height:bounds.height+60});cover.show();cover.focus();}
   if(mode==='transparent'){cover.setOpacity(0.35);}
   if(mode==='multiple'){cover.setOpacity(1);cover.setBounds({x:bounds.x-30,y:bounds.y-30,width:bounds.width/2+35,height:bounds.height+60});cover.show();second.setBounds({x:bounds.x+bounds.width/2,y:bounds.y-30,width:bounds.width/2+30,height:bounds.height+60});second.show();second.focus();}
   if(mode==='uncover'){cover.hide();second.hide();main.restore();main.show();main.focus();}
   if(mode==='minimize'){main.minimize();}
   if(mode==='hide'){main.hide();}
   if(mode==='child'){child=await make('Visibility viewing child','#202080');child.setBounds({x:bounds.x+60,y:bounds.y+60,width:360,height:240});child.setAlwaysOnTop(true,'screen-saver');child.show();child.focus();}
   if(mode==='child-hide'){child.hide();}
   if(mode==='child-close'){child.destroy();child=undefined;}
   if(mode==='lock'){blocked=true;}
   if(mode==='unlock'){blocked=false;}
   monitor.sync();
  },
  dispose(){monitor.dispose();cover.destroy();second.destroy();child?.destroy();main.destroy();},
 };
 app.on('before-quit',()=>monitor.dispose());
});
`,
);
const built = await Bun.build({
  entrypoints: [entry],
  target: "node",
  format: "cjs",
  external: ["electron"],
});
if (!built.success)
  throw new AggregateError(built.logs, "Visibility fixture build failed");
const main = join(directory, "main.cjs");
await writeFile(main, await built.outputs[0]!.text());
const app = await _electron.launch({
  args: [main, "--user-data-dir=" + join(directory, "profile"), "--mute-audio"],
});
interface Fixture {
  read(): { visible: boolean; mainFocused: boolean; changes: boolean[] };
  watch(value: boolean): boolean;
  mode(mode: string): Promise<void>;
  dispose(): void;
}
const read = () =>
  app.evaluate(() =>
    (
      globalThis as unknown as { visibilityFixture: Fixture }
    ).visibilityFixture.read(),
  );
const mode = (value: string) =>
  app.evaluate(
    (_, value) =>
      (
        globalThis as unknown as { visibilityFixture: Fixture }
      ).visibilityFixture.mode(value),
    value,
  );
const visible = (expected: boolean) =>
  expect
    .poll(async () => (await read()).visible, { timeout: 10000 })
    .toBe(expected);
try {
  await expect
    .poll(() =>
      app.evaluate(() =>
        Boolean(
          (globalThis as unknown as { visibilityFixture?: Fixture })
            .visibilityFixture,
        ),
      ),
    )
    .toBe(true);
  await app.evaluate(() =>
    (
      globalThis as unknown as { visibilityFixture: Fixture }
    ).visibilityFixture.watch(true),
  );
  await visible(true);
  await mode("partial");
  await visible(true);
  expect((await read()).mainFocused).toBe(false);
  await mode("full");
  await visible(false);
  await mode("transparent");
  await visible(true);
  await mode("multiple");
  await visible(false);
  await mode("uncover");
  await visible(true);
  await mode("minimize");
  await visible(false);
  await mode("uncover");
  await visible(true);
  await mode("hide");
  await visible(false);
  await mode("uncover");
  await mode("full");
  await visible(false);
  await mode("child");
  await visible(true);
  await mode("lock");
  await visible(false);
  await mode("unlock");
  await visible(true);
  await mode("child-hide");
  await visible(false);
  await mode("child-close");
  await visible(false);
  const result = {
    platform: process.platform,
    partialVisibilityKeepsVideo: true,
    focusIndependent: true,
    fullAndMultipleOcclusionPauses: true,
    transparentCoverKeepsVideo: true,
    minimizeHideAndRestore: true,
    viewingChildKeepsVideo: true,
    lockAndChildCleanup: true,
    productionTestDataCreated: false,
  };
  const output = resolve(".local/watch-visibility-verification");
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, process.platform + ".json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
