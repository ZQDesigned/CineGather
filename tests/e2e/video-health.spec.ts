import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { registerTestAccount } from "./helpers/account";
import { unzipSync, strFromU8 } from "fflate";
test("real shared video reports healthy playback and injected pipeline faults receive plain-language diagnoses", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(180000);
  const context = await browser.newContext({ permissions: ["microphone"] }),
    viewer = await context.newPage();
  const people: string[] = [],
    rooms: string[] = [];
  type Fault =
    | "none"
    | "network"
    | "decode"
    | "render"
    | "static"
    | "unavailable";
  await viewer.addInitScript(() => {
    Object.assign(window, { videoFault: "none" });
    const stats = RTCRtpReceiver.prototype.getStats;
    RTCRtpReceiver.prototype.getStats = async function (this: RTCRtpReceiver) {
      const mode = (window as unknown as { videoFault: string }).videoFault;
      if (this.track.kind !== "video" || mode === "none")
        return stats.call(this);
      if (mode === "unavailable")
        throw Error("Injected receiver stats failure");
      const report = await stats.call(this),
        result = new Map<string, unknown>(),
        at = performance.now() / 1000;
      report.forEach((s) => {
        if (s.type !== "inbound-rtp" || s.kind !== "video") {
          result.set(s.id, s);
          return;
        }
        const received = mode === "static" ? 0 : mode === "network" ? 3 : 30,
          decoded =
            mode === "static"
              ? 0
              : ["network", "decode"].includes(mode)
                ? 3
                : 30;
        result.set(s.id, {
          ...s,
          framesReceived: 100000 + Math.floor(at * received),
          framesDecoded: 100000 + Math.floor(at * decoded),
          framesPerSecond: decoded,
          packetsReceived: 100000 + Math.floor(at * 100),
          packetsLost: mode === "network" ? Math.floor(at * 25) : 0,
          jitter: mode === "network" ? 0.09 : 0.002,
          totalDecodeTime:
            (100000 + at * decoded) * (mode === "decode" ? 0.1 : 0.005),
        });
      });
      return result as unknown as RTCStatsReport;
    };
  });
  try {
    await page.goto("/");
    await registerTestAccount(page, "画面诊断共享端");
    people.push(
      await page.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().user.id;
      }),
    );
    await page.evaluate(() => {
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const c = canvas.getContext("2d")!;
        let frame = 0;
        const timer = setInterval(() => {
          c.fillStyle = frame++ % 2 ? "#6543b0" : "#2a586b";
          c.fillRect(0, 0, 640, 360);
          c.fillStyle = "white";
          c.font = "24px sans-serif";
          c.fillText(String(frame), 40, 60);
        }, 50);
        const stream = canvas.captureStream(20);
        stream
          .getVideoTracks()[0]!
          .addEventListener("ended", () => clearInterval(timer));
        return stream;
      };
    });
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("实际画面诊断验证");
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { state } = await import("/store.ts" as string);
          return state().roomState;
        }),
      )
      .toBe("connected");
    rooms.push(
      await page.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().room.id;
      }),
    );
    const code = (
      await page
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await viewer.goto("/");
    await registerTestAccount(viewer, "画面诊断观看端");
    people.push(
      await viewer.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().user.id;
      }),
    );
    await viewer.getByRole("button", { name: "加入房间", exact: true }).click();
    await viewer.getByLabel("房间号或邀请链接").fill(code);
    await viewer.getByRole("button", { name: "进入房间", exact: true }).click();
    await page
      .getByRole("button", { name: "选择屏幕开始共享", exact: true })
      .click();
    await page.getByRole("button", { name: "选择并共享", exact: true }).click();
    await viewer.getByRole("button", { name: "加入观看", exact: true }).click();
    await expect
      .poll(
        () =>
          viewer
            .getByLabel("共享画面", { exact: true })
            .evaluate((v) => (v as HTMLVideoElement).videoWidth),
        { timeout: 15000 },
      )
      .toBeGreaterThan(0);
    await viewer
      .getByRole("menuitem", { name: "连接诊断", exact: true })
      .click();
    const dialog = viewer.getByRole("dialog", {
      name: "连接诊断",
      exact: true,
    });
    await expect(dialog).toContainText("画面正在正常更新", { timeout: 20000 });
    const fault = async (mode: Fault, title: string) => {
      await viewer.evaluate(async (mode) => {
        const w = window as unknown as {
          videoFault: string;
          videoPlay?: () => Promise<void>;
        };
        w.videoFault = mode;
        const v = document.querySelector<HTMLVideoElement>(
          'video[aria-label="共享画面"]',
        )!;
        if (!w.videoPlay) w.videoPlay = v.play.bind(v);
        if (mode === "none") {
          v.play = w.videoPlay;
          await v.play();
        } else {
          v.play = async () => {};
          v.pause();
        }
      }, mode);
      await expect(dialog).toContainText(title, { timeout: 20000 });
    };
    await fault("decode", "本机处理画面较慢");
    await fault("render", "本机播放画面跟不上");
    await fault("network", "网络接收不稳定");
    await fault("static", "画面更新较少");
    await expect(dialog).toContainText("共享内容可能比较静止");
    await fault("unavailable", "暂时无法确认画面状态");
    const pending = viewer.waitForEvent("download");
    await dialog.getByRole("button", { name: "导出诊断", exact: true }).click();
    const stream = await (await pending).createReadStream(),
      chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
    const zip = unzipSync(Buffer.concat(chunks)),
      snapshot = JSON.parse(strFromU8(zip["current.json"]!));
    expect(snapshot.videoHealth.kind).toBe("unavailable");
    expect(
      snapshot.issues.some((i: { stage: string }) => i.stage === "rtc"),
    ).toBe(true);
    await fault("none", "画面正在正常更新");
    await viewer.screenshot({
      path: info.outputPath("video-health-normal.png"),
    });
    await viewer.evaluate(async () => {
      const { media } = await import("/controller.ts" as string);
      media.setVideoVisible(false);
    });
    await expect(dialog).toContainText("画面检查已暂停");
    console.log(
      JSON.stringify({
        realSharedVideo: true,
        faults: ["decode", "render", "network", "static", "unavailable"],
        staticNeutral: true,
        exportRetainsEvidence: true,
        hiddenPausesDiagnosis: true,
        productionDataCreated: false,
      }),
    );
  } catch (error) {
    console.error("Video health scenario failed", String(error));
    throw error;
  } finally {
    for (const p of [page, viewer])
      await p
        .evaluate(async () => {
          const a = await import("/controller.ts" as string);
          await a.roomSession.leave();
        })
        .catch(() => {});
    await context.close();
    if (people.length)
      execFileSync(
        "bun",
        [
          "tests/e2e/helpers/cleanup-room-invitations.ts",
          JSON.stringify({ users: people, rooms }),
        ],
        { stdio: "pipe" },
      );
  }
});
