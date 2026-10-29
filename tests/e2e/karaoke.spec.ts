import {
  test,
  expect,
  _electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";
import { defaultSettings } from "../../apps/desktop/src/shared/settings";

test("four native singing clients and a web listener exercise real audio, compensation and permission removal", async ({
  browser,
  request,
}, testInfo) => {
  test.skip(
    process.platform !== "darwin" || process.env.ENABLE_KARAOKE_PREVIEW !== "1",
    "Local Mac karaoke preview opt-in",
  );
  test.setTimeout(240000);
  const people: { id: string; token: string }[] = [],
    apps: ElectronApplication[] = [],
    profiles: string[] = [],
    pages: Page[] = [],
    rooms: string[] = [];
  const webContext = await browser.newContext();
  const api = "http://127.0.0.1:14310/api/v1";
  const create = async (i: number, platform = "darwin") => {
    const response = await request.post(api + "/accounts/register", {
      headers: {
        "X-CineGather-Platform": platform,
        "X-CineGather-Version": "0.1.22",
      },
      data: {
        username: "kr_" + crypto.randomUUID().replaceAll("-", "").slice(0, 20),
        displayName: i === 4 ? "合唱听众" : "合唱测试" + (i + 1),
        password: "Local karaoke preview 123!",
      },
    });
    expect(response.status()).toBe(201);
    const data = await response.json();
    const account = {
      id: data.user.id as string,
      token: data.sessionToken as string,
    };
    people.push(account);
    return account;
  };
  const connect = async (p: Page, account: { token: string }, i: number) => {
    if (i < 4) await expect(p.locator(".app")).toBeVisible();
    else await p.goto("http://127.0.0.1:5173");
    await p.evaluate((token) => {
      localStorage.setItem("cinegather.api", "http://127.0.0.1:14310");
      localStorage.setItem("cinegather.session", token);
    }, account.token);
    await p.reload();
    await expect(
      p.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeVisible();
    if (i < 4)
      await p.evaluate(
        (frequency) => {
          navigator.mediaDevices.getUserMedia = async () => {
            const context = new AudioContext({
                sampleRate: 48000,
                latencyHint: "interactive",
              }),
              oscillator = context.createOscillator(),
              gain = context.createGain(),
              destination = context.createMediaStreamDestination();
            oscillator.frequency.value = frequency;
            gain.gain.value = 0;
            oscillator.connect(gain).connect(destination);
            oscillator.start();
            await context.resume();
            const wall = Date.now(),
              audio = context.currentTime,
              first = Math.ceil((wall + 200) / 500) * 500;
            for (let n = 0; n < 600; n++) {
              const time = audio + (first + n * 500 - wall) / 1000;
              gain.gain.setValueAtTime(0.025, time);
              gain.gain.setValueAtTime(0, time + 0.08);
            }
            const track = destination.stream.getAudioTracks()[0]!;
            track.applyConstraints = async () => {}; // Synthetic oscillator has no selectable physical device.
            return destination.stream;
          };
        },
        440 + i * 160,
      );
  };
  const openPanel = async (p: Page) => {
    if (await p.getByRole("dialog").count()) await p.keyboard.press("Escape");
    await expect(p.getByRole("dialog")).toHaveCount(0);
    await p.getByRole("button", { name: /合唱验证|合唱中（/ }).click();
  };
  const joinRoom = async (p: Page, code: string) => {
    await p.getByRole("button", { name: "加入房间", exact: true }).click();
    await p.getByLabel("房间号或邀请链接").fill(code);
    await p.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(p.getByRole("dialog")).toHaveCount(0);
    await expect(p.locator(".connection")).toContainText("已连接");
  };
  const sample = async (p: Page, seconds: number) =>
    p.evaluate(async (seconds) => {
      const elements = [
        ...document.querySelectorAll<HTMLAudioElement>(
          'audio[data-cinegather-audio="microphone"]',
        ),
      ];
      const context = new AudioContext({
        sampleRate: 48000,
        latencyHint: "interactive",
      });
      await context.resume();
      const merger = context.createChannelMerger(elements.length),
        processor = context.createScriptProcessor(1024, elements.length, 1),
        silent = context.createGain();
      silent.gain.value = 0;
      const sources = elements.map((el, i) => {
        const source = context.createMediaStreamSource(
          el.srcObject as MediaStream,
        );
        source.connect(merger, 0, i);
        return source;
      });
      merger.connect(processor).connect(silent).connect(context.destination);
      const peaks = elements.map(() => [] as number[]),
        last = elements.map(() => -1e10),
        lastLoud = elements.map(() => -1e10),
        energy = elements.map(() => 0),
        count = elements.map(() => 0);
      let cursor = 0;
      processor.onaudioprocess = (e) => {
        for (let c = 0; c < elements.length; c++) {
          const data = e.inputBuffer.getChannelData(c);
          for (let i = 0; i < data.length; i++) {
            const x = data[i]!,
              at = ((cursor + i) / context.sampleRate) * 1000;
            energy[c]! += x * x;
            count[c]!++;
            if (Math.abs(x) > 0.004) {
              if (at - lastLoud[c]! > 50 && at - last[c]! > 250) {
                peaks[c]!.push(at);
                last[c] = at;
              }
              lastLoud[c] = at;
            }
          }
        }
        cursor += e.inputBuffer.length;
      };
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      processor.onaudioprocess = null;
      sources.forEach((s) => s.disconnect());
      merger.disconnect();
      processor.disconnect();
      silent.disconnect();
      await context.close();
      return {
        peaks,
        rms: energy.map((value, i) => Math.sqrt(value / count[i]!)),
        purposes: elements.map((e) => e.dataset.cinegatherPurpose),
      };
    }, seconds);
  try {
    for (let i = 0; i < 4; i++) {
      const account = await create(i),
        profile = await mkdtemp(join(tmpdir(), "cg-karaoke-"));
      profiles.push(profile);
      await writeFile(
        join(profile, "settings.json"),
        JSON.stringify({
          ...defaultSettings,
          noiseReduction: "off",
          autoDownloadUpdates: false,
          notifications: { ...defaultSettings.notifications, sound: false },
          pttShortcut: "Control+Alt+Shift+F" + (i * 2 + 1),
          muteShortcut: "Control+Alt+Shift+F" + (i * 2 + 2),
        }),
      );
      const app = await _electron.launch({
        args: [
          resolve("apps/desktop/out/main/index.cjs"),
          "--user-data-dir=" + profile,
          "--mute-audio",
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
          "--autoplay-policy=no-user-gesture-required",
        ],
        env: { ...process.env, ELECTRON_RENDERER_URL: "http://127.0.0.1:5173" },
      });
      apps.push(app);
      const p = await app.firstWindow();
      pages.push(p);
      p.setDefaultTimeout(15000);
      await connect(p, account, i);
    }
    const owner = pages[0]!;
    await owner
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await owner.getByLabel("房间名称").fill("四人合唱验证");
    await owner
      .getByRole("button", { name: "创建并进入", exact: true })
      .click();
    await expect
      .poll(
        () =>
          owner.evaluate(async () => {
            const { state } = await import("/store.ts" as string);
            return state().room?.id;
          }),
        { timeout: 20000 },
      )
      .toBeTruthy();
    rooms.push(
      await owner.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().room.id as string;
      }),
    );
    const code = (
      await owner
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await openPanel(owner);
    await owner
      .getByRole("button", { name: "开启合唱模式", exact: true })
      .click();
    await expect(
      owner.getByRole("button", { name: "加入合唱", exact: true }),
    ).toBeVisible();
    await owner.getByRole("button", { name: "加入合唱", exact: true }).click();
    await expect(
      owner.getByRole("button", { name: "退出合唱", exact: true }),
    ).toBeVisible();
    await owner.keyboard.press("Escape");
    const joinSinger = async (i: number) => {
      await joinRoom(pages[i]!, code);
      await openPanel(pages[i]!);
      await pages[i]!.getByRole("button", {
        name: "加入合唱",
        exact: true,
      }).click();
      await expect(
        pages[i]!.getByRole("button", { name: "退出合唱", exact: true }),
      ).toBeVisible();
      await pages[i]!.keyboard.press("Escape");
    };
    await joinSinger(1);
    const listener = await webContext.newPage();
    pages.push(listener);
    await connect(listener, await create(4, "web"), 4);
    await joinRoom(listener, code);
    await openPanel(listener);
    await expect(
      listener.getByRole("button", { name: "加入合唱", exact: true }),
    ).toHaveCount(0);
    await expect(listener.getByText(/网页版可以收听合唱/)).toBeVisible();
    await listener.keyboard.press("Escape");
    await expect
      .poll(
        () =>
          listener.locator('audio[data-cinegather-purpose="voice"]').count(),
        { timeout: 20000 },
      )
      .toBe(2);
    const two = await sample(listener, 3);
    expect(two.peaks.filter((p) => p.length >= 4)).toHaveLength(2);
    await joinSinger(2);
    await joinSinger(3);

    await expect
      .poll(
        () =>
          listener.locator('audio[data-cinegather-purpose="voice"]').count(),
        { timeout: 20000 },
      )
      .toBe(4);
    // Uses the existing accompaniment publication, independent of microphone state.
    await owner.evaluate(async () => {
      const actions = await import("/controller.ts" as string);
      const c = new AudioContext({ sampleRate: 48000 }),
        o = c.createOscillator(),
        g = c.createGain(),
        d = c.createMediaStreamDestination();
      o.frequency.value = 220;
      g.gain.value = 0.025;
      o.connect(g).connect(d);
      o.start();
      await c.resume();
      await actions.media.publishAccompaniment(d.stream.getAudioTracks()[0]);
    });
    await expect(
      listener.locator('audio[data-cinegather-purpose="accompaniment"]'),
    ).toHaveCount(1);
    await expect
      .poll(
        async () => {
          const result = await sample(listener, 1);
          return result.rms.every((x) => x > 0.001);
        },
        { timeout: 15000 },
      )
      .toBe(true);
    const before = await sample(listener, 5);
    expect(before.peaks.filter((p) => p.length >= 8)).toHaveLength(4);
    // 100ms compensation must move the actual transmitted voice, not only a UI label.
    await pages[3]!.evaluate(async () => {
      const a = await import("/controller.ts" as string);
      await a.media.configureSinging({ delayMs: 100 });
    });
    const after = await sample(listener, 5);
    const spread = (value: typeof before) => {
      const singers = value.peaks.filter((p) => p.length >= 8);
      return singers[0]!
        .slice(1, -1)
        .map((t) => {
          const same = singers.map((p) =>
            p.reduce(
              (best, n) => (Math.abs(n - t) < Math.abs(best - t) ? n : best),
              p[0]!,
            ),
          );
          return Math.max(...same) - Math.min(...same);
        })
        .sort((a, b) => a - b);
    };
    const firstSpread = spread(before),
      lastSpread = spread(after),
      median = (xs: number[]) => xs[Math.floor(xs.length / 2)]!;
    expect(median(lastSpread) - median(firstSpread)).toBeGreaterThan(50);
    await pages[3]!.evaluate(async () => {
      const a = await import("/controller.ts" as string);
      await a.media.configureSinging({ delayMs: 0 });
    });
    const snapshot = await listener.evaluate(async () => {
      const a = await import("/controller.ts" as string);
      await a.media.detailedDiagnostics();
      await new Promise((r) => setTimeout(r, 1000));
      return a.media.detailedDiagnostics();
    });
    expect(snapshot.karaoke?.singing).toBe(false);
    expect(
      snapshot.karaoke?.measurements.some(
        (m: { queueMs?: number }) => typeof m.queueMs === "number",
      ),
    ).toBe(true);
    const evidence = {
      nativeSingerCount: 4,
      twoSingerAudioVerified: true,
      webListener: true,
      receivedAudioTracks: before.rms.length,
      voiceRms: before.rms,
      medianOnsetSkewMs: median(firstSpread),
      compensatedOnsetSkewMs: median(lastSpread),
      pulseStreamsAlignedWithin30Ms: median(firstSpread) <= 30,
      realTimeEnsembleVerified: false,
      measurements: snapshot.karaoke,
      scope:
        "Synthetic audio through real Electron/WebRTC on this Mac; excludes physical microphone/headphone latency and wide-area Internet",
    };
    await testInfo.attach("karaoke-measurements", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
    console.log(JSON.stringify(evidence));
    const archivePath = testInfo.outputPath("native-diagnostics.zip");
    await apps[0]!.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, archivePath);
    expect(
      await owner.evaluate(async () => {
        const a = await import("/controller.ts" as string);
        return a.diagnostics.export(await a.media.diagnostics());
      }),
    ).toBe(true);
    const zip = unzipSync(new Uint8Array(await readFile(archivePath)));
    expect(JSON.parse(strFromU8(zip["current.json"]!)).karaoke.singing).toBe(
      true,
    );
    expect(strFromU8(zip["timeline.ndjson"]!)).toContain('"karaoke"');
    await testInfo.attach("native-diagnostic-bundle", {
      path: archivePath,
      contentType: "application/zip",
    });
    // Re-allowing microphone permission must not silently reclaim a removed seat.
    for (const allowed of [false, true]) {
      const response = await request.post(
        api + `/rooms/${rooms[0]}/members/${people[1]!.id}/permissions`,
        {
          headers: { Authorization: "Bearer " + people[0]!.token },
          data: { microphoneAllowed: allowed },
        },
      );
      expect(response.status()).toBe(201);
      await expect
        .poll(
          () =>
            pages[1]!.evaluate(async () => {
              const { state } = await import("/store.ts" as string);
              return state().karaoke?.singing;
            }),
          { timeout: 10000 },
        )
        .toBe(false);
    }
    expect(
      await pages[1]!.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().media.participants.find(
          (p: { local: boolean }) => p.local,
        )?.microphone;
      }),
    ).toBe(false);
    // Explicit local monitoring is muted by a microphone close and stays muted through polling.
    await owner.evaluate(async () => {
      const a = await import("/controller.ts" as string);
      await a.media.configureSinging({ monitor: 0.2 }, true);
      await a.media.microphone(false);
    });
    await expect
      .poll(() =>
        owner.evaluate(async () => {
          const a = await import("/controller.ts" as string);
          return a.media.singingStatus.monitorActive;
        }),
      )
      .toBe(false);
    await owner.waitForTimeout(3000);
    expect(
      await owner.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().media.participants.find(
          (p: { local: boolean }) => p.local,
        )?.microphone;
      }),
    ).toBe(false);
    await owner.evaluate(async () => {
      const a = await import("/controller.ts" as string);
      await a.media.configureSinging({ monitor: 0 }, true);
    });
    await openPanel(owner);
    await expect(owner.getByRole("dialog")).toBeVisible();
    await owner.screenshot({
      path: testInfo.outputPath("four-singers.png"),
      animations: "disabled",
    });
    const target = pages[3]!;
    await owner
      .getByText("合唱测试4", { exact: true })
      .locator("..")
      .getByRole("button", { name: "移出", exact: true })
      .click();
    await expect
      .poll(
        () =>
          target.evaluate(async () => {
            const { state } = await import("/store.ts" as string);
            return state().karaoke?.singing;
          }),
        { timeout: 10000 },
      )
      .toBe(false);
    await expect(
      target.getByRole("button", { name: "开启麦克风", exact: true }),
    ).toBeDisabled();
    await owner.getByRole("button", { name: "结束合唱", exact: true }).click();
    await owner.keyboard.press("Escape");
    await expect
      .poll(
        () =>
          listener.evaluate(async () => {
            const { state } = await import("/store.ts" as string);
            return state().karaoke?.enabled;
          }),
        { timeout: 10000 },
      )
      .toBe(false);
    expect(
      await listener.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().media.participants.find(
          (p: { local: boolean }) => p.local,
        )?.microphone;
      }),
    ).toBe(false);
  } catch (error) {
    console.error("karaoke scenario failed", String(error));
    for (const p of pages)
      console.log(
        "failure-state",
        await p
          .evaluate(async () => {
            const { state } = await import("/store.ts" as string);
            const s = state();
            return {
              roomState: s.roomState,
              error: s.error,
              busy: s.busy,
              stage: s.karaoke,
              mediaState: s.media.state,
            };
          })
          .catch(() => undefined),
      );
    throw error;
  } finally {
    for (const p of pages)
      await p
        .evaluate(async () => {
          const a = await import("/controller.ts" as string);
          await a.roomSession.leave();
        })
        .catch(() => {});
    for (const person of people) {
      const response = await request
        .get(api + "/rooms", {
          headers: { Authorization: "Bearer " + person.token },
        })
        .catch(() => undefined);
      if (response?.ok()) {
        const data = await response.json();
        for (const room of data.items ?? [])
          if (
            people.some((p) => p.id === room.ownerUserId) &&
            !rooms.includes(room.id)
          )
            rooms.push(room.id);
      }
    }
    for (const app of apps) await app.close().catch(() => {});
    await webContext.close();
    for (const profile of profiles)
      await rm(profile, { recursive: true, force: true });
    if (people.length)
      execFileSync(
        "bun",
        [
          "tests/e2e/helpers/cleanup-room-invitations.ts",
          JSON.stringify({ users: people.map((p) => p.id), rooms }),
        ],
        { stdio: "pipe" },
      );
  }
});
