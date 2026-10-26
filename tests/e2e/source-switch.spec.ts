import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { registerTestAccount } from "./helpers/account";
type CaptureWindow = Window & {
  captureIndex: number;
  cancelNext: boolean;
  captureCanvases: HTMLCanvasElement[];
};
async function color(page: Page) {
  return page
    .locator(".stage video")
    .first()
    .evaluate((v) => {
      const video = v as HTMLVideoElement;
      const c = document.createElement("canvas");
      c.width = 16;
      c.height = 16;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(video, 0, 0, 16, 16);
      const p = ctx.getImageData(4, 4, 1, 1).data;
      return { red: p[0]!, blue: p[2]! };
    });
}
test("native source switch preserves viewer consent and publication, and cancel keeps the old picture", async ({
  browser,
}) => {
  test.skip(
    process.platform !== "darwin" ||
      process.env.CINEGATHER_SOURCE_SWITCH_TEST !== "1",
    "Opt-in real Mac window capture",
  );
  test.setTimeout(180000);
  const work = await mkdtemp(join(tmpdir(), "cg-switch-"));
  let source: ChildProcess | undefined, app: ElectronApplication | undefined;
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  try {
    const contents = resolve(
      ".local/source-switch-devices/CGSwitchFixture.app/Contents",
    );
    await mkdir(join(contents, "MacOS"), { recursive: true });
    await writeFile(
      join(contents, "Info.plist"),
      `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>city.cinegather.fixture.switch</string><key>CFBundleName</key><string>CG Switch Fixture</string><key>CFBundleExecutable</key><string>Source</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>`,
    );
    execFileSync("clang++", [
      "-std=c++17",
      "-fobjc-arc",
      resolve("tests/fixtures/native-switch-source.mm"),
      "-framework",
      "AppKit",
      "-o",
      join(contents, "MacOS/Source"),
    ]);
    execFileSync(
      "codesign",
      ["--force", "--sign", "-", resolve(contents, "..")],
      { stdio: "pipe" },
    );
    source = spawn(join(contents, "MacOS/Source"), [], { stdio: "pipe" });
    source.stderr?.resume();
    app = await electron.launch({
      args: [
        resolve("apps/desktop/out/main/index.cjs"),
        `--user-data-dir=${work}`,
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    });
    const sender = await app.firstWindow();
    await registerTestAccount(sender, "来源切换发布测试");
    await sender
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await sender.getByLabel("房间名称").fill("共享来源切换本机验证");
    await sender
      .getByRole("button", { name: "创建并进入", exact: true })
      .click();
    await expect(sender.locator(".connection")).toContainText("已连接");
    const code = (
      await sender
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await viewer.goto("/");
    await registerTestAccount(viewer, "来源切换观看测试");
    await viewer.getByRole("button", { name: "加入房间", exact: true }).click();
    await viewer.getByLabel("房间号或邀请链接").fill(code);
    await viewer.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(viewer.locator(".connection")).toContainText("已连接");
    await sender.getByRole("button", { name: "共享屏幕", exact: true }).click();
    await sender.getByRole("radio", { name: /CG Switch Red/ }).click();
    const audio = sender.getByRole("checkbox", { name: /共享.*声音/ });
    if (await audio.isChecked()) await audio.uncheck();
    await sender.getByRole("button", { name: "确认共享", exact: true }).click();
    await expect(
      sender.getByRole("button", { name: "切换来源", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await viewer.getByRole("button", { name: "加入观看", exact: true }).click();
    await expect
      .poll(async () => (await color(viewer)).red, { timeout: 15000 })
      .toBeGreaterThan(180);
    expect((await color(viewer)).blue).toBeLessThan(80);
    const track = await viewer
      .locator(".stage video")
      .first()
      .evaluate(
        (v) =>
          (
            (v as HTMLVideoElement).srcObject as MediaStream
          ).getVideoTracks()[0]!.id,
      );
    await sender.getByRole("button", { name: "切换来源", exact: true }).click();
    await sender.getByRole("radio", { name: /CG Switch Blue/ }).click();
    await sender.getByRole("button", { name: "取消", exact: true }).click();
    expect((await color(viewer)).red).toBeGreaterThan(180);
    await sender.getByRole("button", { name: "切换来源", exact: true }).click();
    await sender.getByRole("radio", { name: /CG Switch Blue/ }).click();
    await sender.getByRole("button", { name: "确认切换", exact: true }).click();
    await expect
      .poll(async () => (await color(viewer)).blue, { timeout: 15000 })
      .toBeGreaterThan(180);
    expect((await color(viewer)).red).toBeLessThan(80);
    expect(
      await viewer
        .getByRole("button", { name: "加入观看", exact: true })
        .count(),
    ).toBe(0);
    expect(
      await viewer
        .locator(".stage video")
        .first()
        .evaluate(
          (v) =>
            (
              (v as HTMLVideoElement).srcObject as MediaStream
            ).getVideoTracks()[0]!.id,
        ),
    ).toBe(track);
    source.stdin?.end();
    await expect(
      sender.getByRole("button", { name: "重新选择来源", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      sender.getByText("共享窗口已关闭", { exact: true }),
    ).toBeVisible();
    console.log(
      JSON.stringify({
        nativeSwitch: true,
        realPixelChange: "red-to-blue",
        viewerTrackRetained: true,
        cancelKeepsOld: true,
        closedWindowRecovery: true,
      }),
    );
  } finally {
    await app?.close().catch(() => {});
    await viewerContext.close();
    source?.kill();
    await rm(work, { recursive: true, force: true });
  }
});

test("browser source replacement retains the video publication and canceled picker keeps the stream", async ({
  browser,
}) => {
  const ownerContext = await browser.newContext();
  const sender = await ownerContext.newPage();
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  try {
    await sender.addInitScript(() => {
      const w = window as unknown as CaptureWindow;
      w.captureIndex = 0;
      w.cancelNext = false;
      w.captureCanvases = [];
      navigator.mediaDevices.getDisplayMedia = async () => {
        if (w.cancelNext) {
          w.cancelNext = false;
          throw new DOMException("Picker canceled", "NotAllowedError");
        }
        const c = document.createElement("canvas");
        c.width = 640;
        c.height = 360;
        const ctx = c.getContext("2d")!;
        const color = w.captureIndex++ % 2 ? "#0714f2" : "#f20907";
        let frame = 0;
        const draw = () => {
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 640, 360);
          ctx.fillStyle = "#fff";
          ctx.fillText(String(frame++), 600, 350);
        };
        draw();
        const timer = setInterval(draw, 33);
        w.captureCanvases.push(c);
        const stream = c.captureStream(30);
        stream
          .getVideoTracks()[0]!
          .addEventListener("ended", () => clearInterval(timer));
        return stream;
      };
    });
    await sender.goto("/");
    await registerTestAccount(sender, "浏览器切换发布测试");
    await sender
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await sender.getByLabel("房间名称").fill("浏览器来源切换本机验证");
    await sender
      .getByRole("button", { name: "创建并进入", exact: true })
      .click();
    await expect(sender.locator(".connection")).toContainText("已连接");
    const code = (
      await sender
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await viewer.goto("/");
    await registerTestAccount(viewer, "浏览器切换观看测试");
    await viewer.getByRole("button", { name: "加入房间", exact: true }).click();
    await viewer.getByLabel("房间号或邀请链接").fill(code);
    await viewer.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(viewer.locator(".connection")).toContainText("已连接");
    await sender.getByRole("button", { name: "共享屏幕", exact: true }).click();
    await sender
      .getByRole("button", { name: "选择并共享", exact: true })
      .click();
    await expect(
      sender.getByRole("button", { name: "切换来源", exact: true }),
    ).toBeVisible();
    await viewer.getByRole("button", { name: "加入观看", exact: true }).click();
    await expect
      .poll(async () => (await color(viewer)).red)
      .toBeGreaterThan(180);
    const id = await viewer
      .locator(".stage video")
      .first()
      .evaluate(
        (v) =>
          (
            (v as HTMLVideoElement).srcObject as MediaStream
          ).getVideoTracks()[0]!.id,
      );
    await sender.evaluate(
      () => ((window as unknown as CaptureWindow).cancelNext = true),
    );
    await sender.getByRole("button", { name: "切换来源", exact: true }).click();
    await sender.getByRole("button", { name: "确认切换", exact: true }).click();
    await expect(
      sender.getByText("未切换来源，继续共享原画面", { exact: true }),
    ).toBeVisible();
    expect((await color(viewer)).red).toBeGreaterThan(180);
    await sender.getByRole("button", { name: "切换来源", exact: true }).click();
    await sender.getByRole("button", { name: "确认切换", exact: true }).click();
    await expect
      .poll(async () => (await color(viewer)).blue)
      .toBeGreaterThan(180);
    expect(
      await viewer
        .locator(".stage video")
        .first()
        .evaluate(
          (v) =>
            (
              (v as HTMLVideoElement).srcObject as MediaStream
            ).getVideoTracks()[0]!.id,
        ),
    ).toBe(id);
    expect(
      await viewer
        .getByRole("button", { name: "加入观看", exact: true })
        .count(),
    ).toBe(0);
    await sender
      .getByRole("button", { name: "停止共享", exact: true })
      .first()
      .click();
    console.log(
      JSON.stringify({
        browserSourceSwitch: true,
        viewerTrackRetained: true,
        cancelKeepsOld: true,
      }),
    );
  } finally {
    await ownerContext.close();
    await viewerContext.close();
  }
});
