import {
  test,
  expect,
  _electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { resolve, join } from "node:path";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";
import { defaultSettings } from "../../apps/desktop/src/shared/settings";
const modulePath = "/@fs" + resolve("packages/media-core/src/ktv-reverb.ts");
test("actual KTV preset has an audible decaying tail and a silent mute gate", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async (module) => {
    const { createKtvReverbGraph } = await import(module);
    const render = async (effect: boolean, muted = false) => {
      const context = new OfflineAudioContext(1, 48000 * 2, 48000),
        source = context.createBufferSource();
      const buffer = context.createBuffer(1, 4800, 48000),
        samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] = 0.15 * Math.sin((2 * Math.PI * 440 * i) / 48000);
      source.buffer = buffer;
      if (effect)
        createKtvReverbGraph(context, source, muted).output.connect(
          context.destination,
        );
      else source.connect(context.destination);
      source.start();
      const data = (await context.startRendering()).getChannelData(0);
      const rms = (start: number, end: number) =>
        Math.sqrt(
          data
            .slice(Math.round(start * 48000), Math.round(end * 48000))
            .reduce((sum, x) => sum + x * x, 0) /
            Math.round((end - start) * 48000),
        );
      return {
        voice: rms(0.02, 0.08),
        tail: rms(0.2, 0.6),
        late: rms(1.2, 1.5),
        peak: data.reduce((n, x) => Math.max(n, Math.abs(x)), 0),
      };
    };
    return {
      dry: await render(false),
      ktv: await render(true),
      muted: await render(true, true),
    };
  }, modulePath);
  expect(result.dry.tail).toBe(0);
  expect(result.ktv.tail).toBeGreaterThan(0.0002);
  expect(result.ktv.tail).toBeGreaterThan(result.ktv.late * 20);
  expect(result.ktv.voice).toBeGreaterThan(0.06);
  expect(result.ktv.peak).toBeLessThan(0.5);
  expect(result.muted.peak).toBe(0);
  console.log(JSON.stringify({ ktvOfflineAudio: result }));
});

test("solo KTV effect persists on desktop, reaches the web listener and leaves accompaniment and mute independent", async ({
  browser,
  request,
}, testInfo) => {
  test.skip(
    process.platform !== "darwin" || process.env.CINEGATHER_KTV_TEST !== "1",
    "Local Mac desktop validation",
  );
  test.setTimeout(180000);
  const api = "http://127.0.0.1:14310/api/v1",
    profiles: string[] = [],
    people: { id: string; token: string }[] = [],
    rooms: string[] = [];
  let desktop: ElectronApplication | undefined, sender: Page | undefined;
  const receiver = await browser.newContext({ permissions: ["microphone"] });
  const listener = await receiver.newPage();
  const create = async (name: string, platform: string) => {
    const response = await request.post(api + "/accounts/register", {
      headers: {
        "X-CineGather-Platform": platform,
        "X-CineGather-Version": "0.1.22",
      },
      data: {
        username: "ktv_" + crypto.randomUUID().replaceAll("-", "").slice(0, 20),
        displayName: name,
        password: "Local KTV fixture 123!",
      },
    });
    expect(response.status()).toBe(201);
    const data = await response.json();
    const p = {
      id: data.user.id as string,
      token: data.sessionToken as string,
    };
    people.push(p);
    return p;
  };
  const login = async (page: Page, token: string, native = false) => {
    if (native) await expect(page.locator(".app")).toBeVisible();
    else await page.goto("/");
    await page.evaluate((token) => {
      localStorage.setItem("cinegather.api", "http://127.0.0.1:14310");
      localStorage.setItem("cinegather.session", token);
    }, token);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeVisible();
  };
  const setEffect = async (value: "none" | "ktv") => {
    await sender!
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await sender!
      .getByRole("combobox", { name: "麦克风音效", exact: true })
      .click();
    await sender!
      .getByRole("option", {
        name: value === "ktv" ? "KTV 混响" : "原声",
        exact: true,
      })
      .click();
    await sender!
      .getByRole("button", { name: "保存设置", exact: true })
      .click();
    await expect(sender!.getByRole("dialog")).toHaveCount(0);
  };
  const sample = async () =>
    listener.evaluate(async () => {
      const elements = [
        ...document.querySelectorAll<HTMLAudioElement>(
          'audio[data-cinegather-audio="microphone"]',
        ),
      ];
      const context = new AudioContext({ sampleRate: 48000 }),
        merger = context.createChannelMerger(elements.length),
        processor = context.createScriptProcessor(1024, elements.length, 1),
        silent = context.createGain();
      silent.gain.value = 0;
      const inputs = elements.map((el, i) => {
        const source = context.createMediaStreamSource(
          el.srcObject as MediaStream,
        );
        source.connect(merger, 0, i);
        return source;
      });
      merger.connect(processor).connect(silent).connect(context.destination);
      await context.resume();
      const events: number[][] = elements.map(() => []),
        tail: number[] = elements.map(() => 0),
        total: number[] = elements.map(() => 0),
        lastLoud: number[] = elements.map(() => -1e9);
      let cursor = 0;
      const energy: number[][] = elements.map(() => []);
      processor.onaudioprocess = (e) => {
        for (let c = 0; c < elements.length; c++) {
          const data = e.inputBuffer.getChannelData(c),
            at = cursor / 48000;
          let sum = 0;
          for (const x of data) sum += x * x;
          const rms = Math.sqrt(sum / data.length);
          energy[c]!.push(rms);
          if (rms > 0.03 && at - lastLoud[c]! > 1) {
            events[c]!.push(energy[c]!.length - 1);
            lastLoud[c] = at;
          }
          total[c]! += sum;
        }
        cursor += e.inputBuffer.length;
      };
      await new Promise((r) => setTimeout(r, 6100));
      processor.onaudioprocess = null;
      for (let c = 0; c < elements.length; c++) {
        for (const onset of events[c]!)
          tail[c]! +=
            energy[c]!.slice(onset + 10, onset + 28).reduce(
              (n, v) => n + v * v,
              0,
            ) / 18;
        tail[c] = events[c]!.length
          ? Math.sqrt(tail[c]! / events[c]!.length)
          : 0;
      }
      inputs.forEach((n) => n.disconnect());
      merger.disconnect();
      processor.disconnect();
      silent.disconnect();
      await context.close();
      return elements.map((e, i) => ({
        purpose: e.dataset.cinegatherPurpose,
        onsets: events[i]!.length,
        tail: tail[i]!,
        rms: Math.sqrt(total[i]! / cursor),
      }));
    });
  try {
    const s = await create("KTV 独唱测试", "darwin"),
      r = await create("KTV 听众测试", "web"),
      profile = await mkdtemp(join(tmpdir(), "cg-ktv-"));
    profiles.push(profile);
    await writeFile(
      join(profile, "settings.json"),
      JSON.stringify({
        ...defaultSettings,
        noiseReduction: "off",
        autoDownloadUpdates: false,
        notifications: { ...defaultSettings.notifications, sound: false },
        pttShortcut: "Control+Alt+Shift+F7",
        muteShortcut: "Control+Alt+Shift+F8",
      }),
    );
    desktop = await _electron.launch({
      args: [
        resolve("apps/desktop/out/main/index.cjs"),
        "--user-data-dir=" + profile,
        "--mute-audio",
        "--use-fake-device-for-media-stream",
        "--use-fake-ui-for-media-stream",
      ],
      env: { ...process.env, ELECTRON_RENDERER_URL: "http://127.0.0.1:5173" },
    });
    sender = await desktop.firstWindow();
    sender.setDefaultTimeout(15000);
    await login(sender, s.token, true);
    await sender.evaluate(() => {
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
        const wall = Date.now(),
          audio = c.currentTime,
          first = Math.ceil((wall + 200) / 2000) * 2000;
        for (let i = 0; i < 180; i++) {
          const t = audio + (first + i * 2000 - wall) / 1000;
          g.gain.setValueAtTime(0.18, t);
          g.gain.setValueAtTime(0, t + 0.08);
        }
        d.stream.getAudioTracks()[0]!.applyConstraints = async () => {};
        return d.stream;
      };
    });
    await sender
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await sender.getByLabel("房间名称").fill("独唱混响验证");
    await sender
      .getByRole("button", { name: "创建并进入", exact: true })
      .click();
    await expect
      .poll(
        () =>
          sender!.evaluate(async () => {
            const { state } = await import("/store.ts" as string);
            return state().room?.id;
          }),
        { timeout: 15000 },
      )
      .toBeTruthy();
    rooms.push(
      await sender.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().room.id;
      }),
    );
    const code = (
      await sender
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await expect(
      sender.getByRole("button", { name: /合唱验证|合唱中/ }),
    ).toHaveCount(0);
    await login(listener, r.token);
    await listener
      .getByRole("button", { name: "加入房间", exact: true })
      .click();
    await listener.getByLabel("房间号或邀请链接").fill(code);
    await listener
      .getByRole("button", { name: "进入房间", exact: true })
      .click();
    await expect(listener.getByRole("dialog")).toHaveCount(0);
    await listener
      .getByRole("button", { name: "关闭麦克风", exact: true })
      .click();
    await expect(
      listener.locator('audio[data-cinegather-purpose="voice"]'),
    ).toHaveCount(1);
    await sender.evaluate(async () => {
      const { media } = await import("/controller.ts" as string);
      const c = new AudioContext(),
        o = c.createOscillator(),
        g = c.createGain(),
        d = c.createMediaStreamDestination();
      o.frequency.value = 220;
      g.gain.value = 0.02;
      o.connect(g).connect(d);
      o.start();
      await c.resume();
      await media.publishAccompaniment(d.stream.getAudioTracks()[0]);
    });
    await expect(
      listener.locator('audio[data-cinegather-purpose="accompaniment"]'),
    ).toHaveCount(1);
    const dry = await sample();
    await setEffect("ktv");
    const ktv = await sample();
    expect(dry.find((x) => x.purpose === "voice")!.onsets).toBeGreaterThan(1);
    expect(ktv.find((x) => x.purpose === "voice")!.tail).toBeGreaterThan(
      dry.find((x) => x.purpose === "voice")!.tail * 3 + 0.0001,
    );
    const musicBefore = dry.find((x) => x.purpose === "accompaniment")!.rms,
      musicAfter = ktv.find((x) => x.purpose === "accompaniment")!.rms;
    expect(musicAfter / musicBefore).toBeGreaterThan(0.9);
    expect(musicAfter / musicBefore).toBeLessThan(1.1);
    await sender
      .getByRole("button", { name: "关闭麦克风", exact: true })
      .click();
    await setEffect("none");
    await setEffect("ktv");
    expect(
      await sender.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().media.participants.find(
          (p: { local: boolean }) => p.local,
        )?.microphone;
      }),
    ).toBe(false);
    expect(
      (await sender.evaluate(() => window.desktop!.loadSettings()))
        .microphoneEffect,
    ).toBe("ktv");
    const path = testInfo.outputPath("ktv-diagnostics.zip");
    await desktop.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, path);
    expect(
      await sender.evaluate(async () => {
        const a = await import("/controller.ts" as string);
        return a.diagnostics.export(await a.media.diagnostics());
      }),
    ).toBe(true);
    const zip = unzipSync(new Uint8Array(await readFile(path)));
    expect(
      JSON.parse(strFromU8(zip["current.json"]!)).microphoneEffect,
    ).toMatchObject({ requested: "ktv", active: "ktv" });
    await sender
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await sender.screenshot({
      path: testInfo.outputPath("ktv-setting.png"),
      animations: "disabled",
    });
    const evidence = {
      dry,
      ktv,
      musicRatio: musicAfter / musicBefore,
      mutePreserved: true,
      nativeSettingsPersisted: true,
    };
    await testInfo.attach("ktv-measurement", {
      body: JSON.stringify(evidence, null, 2),
      contentType: "application/json",
    });
    console.log(JSON.stringify(evidence));
    await sender.keyboard.press("Escape");
    await sender.evaluate(async () => {
      const a = await import("/controller.ts" as string);
      await a.roomSession.leave();
    });
    await sender.reload();
    await sender
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await expect(
      sender.locator(".ant-select").filter({
        has: sender.getByRole("combobox", {
          name: "麦克风音效",
          exact: true,
        }),
      }),
    ).toContainText("KTV 混响");
  } catch (error) {
    console.error("KTV scenario failed", String(error));
    throw error;
  } finally {
    for (const page of [sender, listener])
      await page
        ?.evaluate(async () => {
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
        for (const room of (await response.json()).items ?? [])
          if (
            people.some((p) => p.id === room.ownerUserId) &&
            !rooms.includes(room.id)
          )
            rooms.push(room.id);
      }
    }
    await desktop?.close().catch(() => {});
    await receiver.close();
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
