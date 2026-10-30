import {
  test,
  expect,
  _electron,
  type Page,
  type ElectronApplication,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultSettings } from "../../apps/desktop/src/shared/settings";
async function scenario(page: Page, native = false) {
  const people: string[] = [],
    rooms: string[] = [];
  const api = "http://127.0.0.1:14310/api/v1";
  await page.addInitScript(() => {
    type Route = {
      gain: GainNode;
      destination?: MediaStreamAudioDestinationNode;
      direct: boolean;
    };
    const routes: Route[] = [],
      players: HTMLMediaElement[] = [],
      streams: MediaStream[] = [];
    Object.assign(window, { monitorProbe: { routes, players, streams } });
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (
      this: AudioNode,
      ...args: Parameters<typeof connect>
    ) {
      const dest = args[0];
      if (
        this instanceof GainNode &&
        (dest instanceof AudioDestinationNode ||
          dest instanceof MediaStreamAudioDestinationNode)
      )
        routes.push({
          gain: this,
          direct: dest instanceof AudioDestinationNode,
          destination:
            dest instanceof MediaStreamAudioDestinationNode ? dest : undefined,
        });
      return Reflect.apply(connect, this, args);
    } as typeof connect;
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
      players.push(this);
      return play.call(this);
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const c = new AudioContext({ sampleRate: 48000 }),
        o = c.createOscillator(),
        g = c.createGain(),
        d = c.createMediaStreamDestination();
      d.channelCount = 1;
      o.frequency.value = 440;
      g.gain.value = 0;
      o.connect(g).connect(d);
      o.start();
      await c.resume();
      const first = Math.ceil((Date.now() + 200) / 2000) * 2000,
        wall = Date.now(),
        audio = c.currentTime;
      for (let i = 0; i < 180; i++) {
        const t = audio + (first + i * 2000 - wall) / 1000;
        g.gain.setValueAtTime(0.18, t);
        g.gain.setValueAtTime(0, t + 0.08);
      }
      const track = d.stream.getAudioTracks()[0]!;
      track.applyConstraints = async () => {};
      const stop = track.stop.bind(track);
      track.stop = () => {
        stop();
        void c.close().catch(() => {});
      };
      streams.push(d.stream);
      return d.stream;
    };
  });
  if (!native) await page.goto("/");
  else await expect(page.locator(".app")).toBeVisible();
  const response = await page.request.post(api + "/accounts/register", {
    headers: {
      "X-CineGather-Version": "0.1.23",
      "X-CineGather-Platform": native ? "darwin" : "web",
    },
    data: {
      username:
        "monitor_" + crypto.randomUUID().replaceAll("-", "").slice(0, 16),
      displayName: "耳返本地隔离验证",
      password: "Local monitor fixture 123!",
    },
  });
  expect(response.status()).toBe(201);
  const account = await response.json();
  people.push(account.user.id);
  try {
    await page.evaluate((token) => {
      localStorage.setItem("cinegather.api", "http://127.0.0.1:14310");
      localStorage.setItem("cinegather.session", token);
      if (!window.desktop)
        localStorage.setItem(
          "cinegather.settings",
          JSON.stringify({
            minimizeToTray: false,
            pushToTalk: false,
            pttShortcut: "Control+Shift+Space",
            muteShortcut: "Control+Shift+M",
            quality: "cinema",
            inputDevice: "",
            outputDevice: "",
            noiseReduction: "off",
          }),
        );
    }, account.sessionToken);
    await page.reload();
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("耳返隔离验证");
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    await page.getByRole("button", { name: "关闭麦克风", exact: true }).click();
    rooms.push(
      await page.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().room.id;
      }),
    );
    const trackCount = () =>
      page.evaluate(async () => {
        const { media } = await import("/controller.ts" as string);
        return (await media.detailedDiagnostics()).tracks.filter(
          (t: { local: boolean }) => t.local,
        ).length;
      });
    const before = await trackCount();
    await page.getByRole("button", { name: "麦克风音效", exact: true }).click();
    await page
      .getByRole("menuitemradio", { name: "KTV 混响", exact: true })
      .click();
    const strength = page.getByRole("slider", {
      name: "混响强度",
      exact: true,
    });
    await strength.focus();
    await page.keyboard.press("End");
    await expect(strength).toHaveAttribute("aria-valuenow", "100");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "音频快捷设置", exact: true })
      .click();
    const panel = page.getByRole("region", {
      name: "音频快捷设置",
      exact: true,
    });
    await expect(
      panel.getByRole("switch", { name: "耳返", exact: true }),
    ).not.toBeChecked();
    await panel.getByRole("switch", { name: "耳返", exact: true }).click();
    const state = () =>
      page.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().microphoneMonitor;
      });
    await expect
      .poll(async () => (await state()).state, { timeout: 20000 })
      .toBe("active");
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeEnabled();
    expect(await trackCount()).toBe(before);
    const measure = () =>
      page.evaluate(async () => {
        type Route = {
          gain: GainNode;
          destination?: MediaStreamAudioDestinationNode;
          direct: boolean;
        };
        const probe = (
          window as unknown as {
            monitorProbe: { routes: Route[]; players: HTMLMediaElement[] };
          }
        ).monitorProbe;
        const route = [...probe.routes]
          .reverse()
          .find(
            (r) =>
              r.gain.context.state === "running" &&
              r.gain.gain.value > 0 &&
              (r.direct ||
                probe.players.some(
                  (p) => p.srcObject === r.destination?.stream,
                )),
          )!;
        if (!route) throw Error("No active local monitor output");
        const c = route.gain.context as AudioContext,
          p = c.createScriptProcessor(1024, 1, 1),
          silence = c.createGain();
        silence.gain.value = 0;
        route.gain.connect(p);
        p.connect(silence).connect(c.destination);
        const energy: number[] = [],
          onsets: number[] = [];
        let at = 0,
          last = -1000;
        p.onaudioprocess = (e) => {
          const d = e.inputBuffer.getChannelData(0),
            r = Math.sqrt(d.reduce((n, x) => n + x * x, 0) / d.length);
          energy.push(r);
          if (r > 0.01 && at - last > 40) {
            onsets.push(at);
            last = at;
          }
          at++;
        };
        await new Promise((r) => setTimeout(r, 6100));
        let sum = 0,
          count = 0;
        for (const start of onsets)
          for (let i = start + 10; i < start + 28 && i < energy.length; i++) {
            sum += energy[i]! ** 2;
            count++;
          }
        route.gain.disconnect(p);
        p.disconnect();
        silence.disconnect();
        return {
          onsets: onsets.length,
          tail: Math.sqrt(sum / Math.max(1, count)),
        };
      });
    const strong = await measure();
    expect(strong.onsets).toBeGreaterThan(1);
    expect(strong.tail).toBeGreaterThan(0.0005);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "麦克风音效", exact: true }).click();
    await page.getByRole("slider", { name: "混响强度", exact: true }).focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("Escape");
    const zero = await measure();
    expect(zero.tail).toBeLessThan(strong.tail * 0.1);
    await expect(
      page.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "音频快捷设置", exact: true })
      .click();
    await panel.getByRole("slider", { name: "耳返音量", exact: true }).focus();
    await page.keyboard.press("End");
    await expect.poll(async () => (await state()).volume).toBe(100);
    await page.screenshot({
      path:
        ".local/monitor-video/ear-monitor-" +
        (native ? "desktop" : "browser") +
        ".png",
    });
    await page.keyboard.press("Escape");
    await expect
      .poll(() =>
        page.evaluate(async () =>
          window.desktop
            ? (await window.desktop.loadSettings()).microphoneMonitorVolume
            : JSON.parse(localStorage.getItem("cinegather.settings")!)
                .microphoneMonitorVolume,
        ),
      )
      .toBe(100);
    await page.getByRole("button", { name: "开启麦克风", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "音频快捷设置", exact: true })
      .click();
    await panel.getByRole("switch", { name: "耳返", exact: true }).click();
    await expect.poll(async () => (await state()).state).toBe("off");
    await expect(
      page.getByRole("button", { name: "关闭麦克风", exact: true }),
    ).toBeEnabled();
    expect(await trackCount()).toBe(before);
    await panel.getByRole("switch", { name: "耳返", exact: true }).click();
    await expect
      .poll(async () => (await state()).state, { timeout: 15000 })
      .toBe("active");
    await page.keyboard.press("Escape");
    // Losing the room connection must not trap the local monitor behind a disabled arrow.
    await page.evaluate(async () => {
      const { update } = await import("/store.ts" as string);
      update({ roomState: "reconnecting" });
    });
    await page
      .getByRole("button", { name: "音频快捷设置", exact: true })
      .click();
    await panel.getByRole("switch", { name: "耳返", exact: true }).click();
    await expect.poll(async () => (await state()).state).toBe("off");
    // The live media summary may already restore connected while this assertion
    // runs; explicitly close before re-opening instead of racing that refresh.
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "音频快捷设置", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(panel).not.toBeVisible();
    await page.evaluate(async () => {
      const { update } = await import("/store.ts" as string);
      update({ roomState: "connected" });
    });
    await page
      .getByRole("button", { name: "音频快捷设置", exact: true })
      .click();
    await panel.getByRole("switch", { name: "耳返", exact: true }).click();
    await expect.poll(async () => (await state()).state).toBe("active");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "离开房间", exact: true }).click();
    await expect.poll(async () => (await state()).state).toBe("off");
    console.log(
      JSON.stringify({
        native,
        localMonitor: {
          strong,
          zero,
          privateWhileMuted: true,
          noExtraPublications: true,
          stopLeavesRoomMicOpen: true,
          canStopWhileReconnecting: true,
          leaveStopsCapture: true,
          volumePersisted: 100,
        },
      }),
    );
  } finally {
    await page
      .evaluate(async () => {
        const a = await import("/controller.ts" as string);
        await a.microphoneMonitor.stop();
        await a.roomSession.leave();
      })
      .catch(() => {});
    execFileSync(
      "bun",
      [
        "tests/e2e/helpers/cleanup-room-invitations.ts",
        JSON.stringify({ users: people, rooms }),
      ],
      { stdio: "pipe" },
    );
  }
}
test("browser ear monitor plays processed local voice privately and leaves room mute and publications independent", async ({
  page,
}) => {
  test.setTimeout(120000);
  await scenario(page);
});
test("Mac desktop ear monitor uses the same private pipeline and remembers its volume", async () => {
  test.skip(
    process.platform !== "darwin" ||
      process.env.CINEGATHER_MONITOR_TEST !== "1",
    "Local Mac validation",
  );
  test.setTimeout(120000);
  const profile = await mkdtemp(join(tmpdir(), "cg-monitor-"));
  let app: ElectronApplication | undefined;
  try {
    await writeFile(
      join(profile, "settings.json"),
      JSON.stringify({
        ...defaultSettings,
        noiseReduction: "off",
        autoDownloadUpdates: false,
        notifications: { ...defaultSettings.notifications, sound: false },
        pttShortcut: "Control+Alt+Shift+F9",
        muteShortcut: "Control+Alt+Shift+F10",
      }),
    );
    app = await _electron.launch({
      args: [
        resolve("apps/desktop/out/main/index.cjs"),
        "--user-data-dir=" + profile,
        "--mute-audio",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
      env: { ...process.env, ELECTRON_RENDERER_URL: "http://127.0.0.1:5173" },
    });
    await scenario(await app.firstWindow(), true);
  } finally {
    await app?.close().catch(() => {});
    await rm(profile, { recursive: true, force: true });
  }
});
