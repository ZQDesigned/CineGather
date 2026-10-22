import {
  test,
  expect,
  _electron as electron,
  chromium,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { readFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import {
  startAVSource,
  startOwnTone,
  type AVMeasurement,
} from "../fixtures/audio-measurement";
function quantile(values: number[], p: number) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor(v.length * p))] ?? NaN;
}
function summarize(m: AVMeasurement) {
  const deltas: number[] = [];
  for (const v of m.videoPulses) {
    const cycle = Math.floor(v.stamp / 2000) * 2000;
    const a = m.audioPulses.find(
      (x) => Math.floor((x.at - m.calibrationMs) / 2000) * 2000 === cycle,
    );
    if (a) deltas.push(v.at - (a.at - m.calibrationMs));
  }
  const q = (v: number[]) => ({
    n: v.length,
    p50: quantile(v, 0.5),
    p95: quantile(v, 0.95),
  });
  return {
    videoAgeMs: q(m.samples.map((s) => s.age)),
    videoMinusAudioMs: q(deltas),
    syncDriftMs:
      quantile(deltas.slice(-5), 0.5) - quantile(deltas.slice(0, 5), 0.5),
    audio: Object.fromEntries(
      (["film", "other", "voice", "own"] as const).map((k) => [
        k,
        q(m.audio.map((a) => a[k])),
      ]),
    ),
    voiceSuppressionDb: quantile(
      m.audio.map((a) => a.film - a.voice),
      0.5,
    ),
    ownSuppressionDb: quantile(
      m.audio.map((a) => a.film - a.own),
      0.5,
    ),
    calibrationMs: m.calibrationMs,
  };
}

test("real Mac system mix excludes CineGather playback, stays synchronized and window audio remains isolated", async () => {
  const executablePath = resolve(
    "apps/desktop/release/mac-arm64/CineGather.app/Contents/MacOS/CineGather",
  );
  test.skip(
    process.platform !== "darwin" ||
      process.env.CINEGATHER_SYSTEM_AUDIO_TEST !== "1" ||
      !existsSync(executablePath),
    "Opt-in: real unlocked Mac, existing capture permission, synthetic tones played locally.",
  );
  test.setTimeout(240000);
  const work = await mkdtemp(join(tmpdir(), "cg-system-audio-")),
    reportDir = resolve(".local/system-audio");
  await mkdir(reportDir, { recursive: true });
  const apps: ElectronApplication[] = [];
  let afplay: ChildProcess | undefined;
  const meter = `class PulseMeter extends AudioWorkletProcessor{constructor(){super();this.last=-10;}process(inputs){const a=inputs[0]?.[0];if(a){let sum=0;for(const s of a)sum+=s*s;if(Math.sqrt(sum/a.length)>.003&&currentTime-this.last>1){this.last=currentTime;this.port.postMessage({audioTime:currentTime});}}return true;}}registerProcessor('pulse-meter',PulseMeter);`;
  const bundle = join(work, "receiver.js");
  execFileSync(
    "bun",
    [
      "build",
      "tests/fixtures/audio-receiver.ts",
      "--target=browser",
      `--outfile=${bundle}`,
    ],
    { stdio: "pipe" },
  );
  const script = await readFile(bundle);
  const server = createServer((req, res) => {
    res.setHeader(
      "Content-Type",
      req.url === "/" ? "text/html" : "text/javascript",
    );
    res.end(
      req.url === "/meter.js"
        ? meter
        : req.url === "/receiver.js"
          ? script
          : '<!doctype html><title>CG Audio Measurement</title><script src="/receiver.js"></script>',
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("No local test server");
  const browser = await chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  let publisher: Page | undefined;
  const req = async (path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${process.env.VITE_API_URL}/api/v1${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw Error(`Test API ${response.status} ${path}`);
    return response.json();
  };
  const launch = async (label: string) => {
    const app = await electron.launch({
      executablePath,
      args: [
        `--user-data-dir=${join(work, label)}`,
        "--autoplay-policy=no-user-gesture-required",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    });
    apps.push(app);
    const p = await app.firstWindow();
    await p.getByLabel("你的昵称").fill(label);
    await p.getByRole("button", { name: "进入映聚", exact: true }).click();
    return { app, page: p };
  };
  const share = async (page: Page, screen: boolean) => {
    await page.getByRole("button", { name: "选择屏幕开始共享" }).click();
    if (screen)
      await page.getByRole("tab", { name: "整个屏幕", exact: true }).click();
    else
      await page
        .locator(".source-card")
        .filter({ hasText: "CG System Audio Controlled Source" })
        .getByRole("radio")
        .check();
    await page
      .getByRole("checkbox", {
        name: screen ? "共享系统声音（排除映聚）" : "共享此应用的声音",
        exact: true,
      })
      .check();
    await page.getByRole("button", { name: "确认共享", exact: true }).click();
    await expect(page.locator(".sharing-banner")).toBeVisible({
      timeout: 20000,
    });
  };
  const stop = async (page: Page) => {
    await page
      .locator(".sharing-banner")
      .getByRole("button", { name: "停止共享", exact: true })
      .click();
    await expect(page.locator(".sharing-banner")).toHaveCount(0);
  };
  try {
    const source = await electron.launch({
      args: [resolve("tests/fixtures/audio-source.mjs")],
      timeout: 30000,
    });
    apps.push(source);
    const sourcePage = await source.firstWindow();
    await sourcePage.evaluate(startAVSource);
    // Independent OS process, not the captured window's application.
    const frames = 48000 * 180,
      wav = Buffer.alloc(44 + frames * 2);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(48000, 24);
    wav.writeUInt32LE(96000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(frames * 2, 40);
    for (let i = 0; i < frames; i++)
      wav.writeInt16LE(
        Math.round(Math.sin((i * 2 * Math.PI * 880) / 48000) * 3000),
        44 + i * 2,
      );
    const wave = join(work, "external-880.wav");
    await writeFile(wave, wav);
    afplay = spawn("afplay", [wave], { stdio: "ignore" });
    const a = await launch("系统音频测试 A");
    publisher = a.page;
    await publisher
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await publisher.getByLabel("房间名称").fill("系统声音与回声隔离实测");
    await publisher
      .getByRole("button", { name: "创建并进入", exact: true })
      .click();
    await publisher
      .getByRole("button", { name: "关闭麦克风", exact: true })
      .click();
    await share(publisher, true);
    await publisher
      .getByRole("button", { name: "邀请朋友", exact: true })
      .click();
    const invite = await publisher.getByLabel("房间邀请").inputValue();
    await publisher
      .getByRole("button", { name: "关闭对话框", exact: true })
      .click();
    // Launch the second CineGather instance AFTER capture starts to exercise exclusion updates.
    const b = await launch("系统音频测试 B");
    await b.page.getByRole("button", { name: "加入房间", exact: true }).click();
    await b.page.getByLabel("邀请链接或完整房间码").fill(invite);
    await b.page.getByRole("button", { name: "进入房间", exact: true }).click();
    await b.page
      .getByRole("button", { name: "关闭麦克风", exact: true })
      .click();
    await expect
      .poll(() =>
        b.page
          .locator(".stage video")
          .evaluate((v: HTMLVideoElement) => v.videoWidth),
      )
      .toBeGreaterThan(0);
    expect(await b.page.evaluate(startOwnTone, 2200)).toBe("running");
    const token = await publisher.evaluate(() =>
      localStorage.getItem("cinegather.session"),
    );
    const room = (await req("/rooms", token!)).items[0];
    const invitation = await req(`/rooms/${room.id}/invites`, token!, {
      expiresInHours: 1,
      maxUses: 1,
    });
    const guest = await req("/guests", undefined, {
      displayName: "系统声音测量接收端",
    });
    const joined = await req(`/rooms/${room.id}/join`, guest.sessionToken, {
      inviteToken: invitation.token,
    });
    const observer = await browser.newPage();
    await observer.goto(`http://127.0.0.1:${address.port}`);
    await observer.evaluate(({ token, url }) => window.cgJoin!(token, url), {
      token: joined.token,
      url: process.env.LIVEKIT_PUBLIC_URL ?? "ws://127.0.0.1:7880",
    });
    await expect
      .poll(() => observer.evaluate(() => window.cgReceived?.videoWidth ?? 0), {
        timeout: 20000,
      })
      .toBeGreaterThan(0);
    // Assert real room voice is playing in both actual apps, not merely injected into a meter.
    for (const p of [publisher, b.page])
      await expect
        .poll(
          () =>
            p
              .locator('audio[data-cinegather-audio="microphone"]')
              .evaluateAll((els) =>
                els.some(
                  (e) =>
                    !(e as HTMLAudioElement).paused &&
                    !(e as HTMLAudioElement).muted,
                ),
              ),
          { timeout: 10000 },
        )
        .toBe(true);
    const warm = await observer.evaluate((ms) => window.cgMeasure!(ms), 3000);
    await writeFile(
      join(reportDir, "warm-summary.json"),
      JSON.stringify(summarize(warm), null, 2),
    );
    const probe = await observer.evaluate(async () => {
      const reports = [];
      for (const participant of window.cgRoom!.remoteParticipants.values())
        for (const pub of participant.trackPublications.values())
          if (pub.track)
            reports.push({
              source: pub.source,
              stats: [
                ...((await pub.track.getRTCStatsReport())?.values() ?? []),
              ].filter((s) => s.type === "inbound-rtp"),
            });
      return reports;
    });
    await writeFile(
      join(reportDir, "receiver-inbound.json"),
      JSON.stringify(probe, null, 2),
    );
    expect(
      Number.isFinite(
        quantile(
          warm.audio.map((x) => x.film),
          0.5,
        ),
      ),
    ).toBe(true);
    const warmSummary = summarize(warm);
    expect(warmSummary.voiceSuppressionDb).toBeGreaterThan(40);
    expect(warmSummary.ownSuppressionDb).toBeGreaterThan(40);
    const system = await observer.evaluate(
      (ms) => window.cgMeasure!(ms),
      60000,
    );
    await writeFile(join(reportDir, "system-raw.json"), JSON.stringify(system));
    const systemSummary = summarize(system);
    await writeFile(
      join(reportDir, "system-summary.json"),
      JSON.stringify(systemSummary, null, 2),
    );
    expect(systemSummary.audio.film!.p50).toBeGreaterThan(-55);
    expect(systemSummary.audio.other!.p50).toBeGreaterThan(-60);
    expect(systemSummary.voiceSuppressionDb).toBeGreaterThan(40);
    expect(systemSummary.ownSuppressionDb).toBeGreaterThan(40);
    expect(systemSummary.videoMinusAudioMs.n).toBeGreaterThan(15);
    expect(Math.abs(systemSummary.videoMinusAudioMs.p50)).toBeLessThan(100);
    expect(Math.abs(systemSummary.syncDriftMs)).toBeLessThan(60);
    await publisher.screenshot({
      path: join(reportDir, "system-publisher.png"),
    });
    await b.page.screenshot({ path: join(reportDir, "system-receiver.png") });
    await stop(publisher);
    await share(publisher, false);
    await expect
      .poll(
        () =>
          observer.evaluate(
            () =>
              (window.cgReceived?.isConnected &&
                window.cgReceived.videoWidth > 0) ??
              false,
          ),
        { timeout: 15000 },
      )
      .toBe(true);
    const windowAudio = await observer.evaluate(
      (ms) => window.cgMeasure!(ms),
      20000,
    );
    const windowSummary = summarize(windowAudio);
    await writeFile(
      join(reportDir, "window-summary.json"),
      JSON.stringify(windowSummary, null, 2),
    );
    expect(windowSummary.audio.film!.p50).toBeGreaterThan(-55);
    expect(windowSummary.audio.other!.p50).toBeLessThan(
      windowSummary.audio.film!.p50 - 35,
    );
    expect(windowSummary.voiceSuppressionDb).toBeGreaterThan(40);
    expect(windowSummary.ownSuppressionDb).toBeGreaterThan(40);
    await stop(publisher);
    console.log(
      JSON.stringify({ system: systemSummary, window: windowSummary }),
    );
  } finally {
    if (publisher && !publisher.isClosed())
      await publisher
        .locator(".sharing-banner")
        .getByRole("button", { name: "停止共享", exact: true })
        .click({ timeout: 2000 })
        .catch(() => {});
    afplay?.kill("SIGTERM");
    await browser.close();
    for (const app of apps.reverse()) await app.close().catch(() => {});
    await new Promise<void>((r) => server.close(() => r()));
    await rm(work, { recursive: true, force: true });
  }
});
