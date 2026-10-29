import { test, expect, type Page } from "@playwright/test";
import { registerTestAccount } from "./helpers/account";
import { defaultSettings } from "../../apps/desktop/src/shared/settings";

async function speaker(
  page: Page,
  name: string,
  code: string,
  frequency: number,
) {
  await page.addInitScript(
    (settings) =>
      localStorage.setItem("cinegather.settings", JSON.stringify(settings)),
    { ...defaultSettings, noiseReduction: "off" },
  );
  await page.goto("/");
  await registerTestAccount(page, name);
  await page.evaluate((frequency) => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!constraints?.audio) return original(constraints);
      const context = new AudioContext(),
        oscillator = context.createOscillator(),
        gain = context.createGain(),
        destination = context.createMediaStreamDestination();
      gain.gain.value = 0.025;
      oscillator.frequency.value = frequency;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      await context.resume();
      return destination.stream;
    };
  }, frequency);
  await page.getByRole("button", { name: "加入房间", exact: true }).click();
  await page.getByLabel("房间号或邀请链接").fill(code);
  await page.getByRole("button", { name: "进入房间", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function volume(page: Page, name: string, value: number) {
  await page
    .getByRole("button", { name: `${name}的成员操作`, exact: true })
    .click();
  const slider = page.getByRole("slider", {
    name: `${name}的音量`,
    exact: true,
  });
  await slider.focus();
  await slider.press("Home");
  if (value === 200) await slider.press("End");
  else if (value)
    for (let n = 0; n < value; n++) await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuenow", String(value));
}
async function rms(page: Page, index: number) {
  return page.evaluate(async (index) => {
    const element = document.querySelectorAll<HTMLAudioElement>(
      'audio[data-cinegather-audio="microphone"]',
    )[index]!;
    const stream = element.srcObject as MediaStream;
    const context = new AudioContext(),
      analyser = context.createAnalyser(),
      silent = context.createGain();
    silent.gain.value = 0;
    analyser.fftSize = 4096;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser).connect(silent).connect(context.destination);
    await context.resume();
    const data = new Float32Array(analyser.fftSize);
    let energy = 0;
    for (let n = 0; n < 16; n++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      analyser.getFloatTimeDomainData(data);
      if (n > 3) for (const value of data) energy += value * value;
    }
    source.disconnect();
    analyser.disconnect();
    silent.disconnect();
    await context.close();
    return Math.sqrt(energy / (12 * data.length));
  }, index);
}
async function leave(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const exit = page.getByRole("button", { name: "离开房间", exact: true });
  if (await exit.count()) {
    await exit.click();
    // The API also waits for SFU participant removal before finishing leave.
    await expect(page.locator(".connection")).toContainText("未连接房间", {
      timeout: 15000,
    });
  }
}

test("200% member volume doubles received voice samples, isolates other speakers and retains gain across navigation and resubscription", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(120000);
  await context.grantPermissions(["microphone"]);
  await page.addInitScript(() => {
    const outputs: MediaStreamAudioDestinationNode[] = [];
    const destination = AudioContext.prototype.createMediaStreamDestination;
    AudioContext.prototype.createMediaStreamDestination = function () {
      const output = destination.call(this);
      outputs.push(output);
      return output;
    };
    Object.assign(window, { voiceProbe: { outputs } });
  });
  const contexts = await Promise.all(
    [0, 1].map(() => browser.newContext({ permissions: ["microphone"] })),
  );
  const [quiet, normal] = (await Promise.all(
    contexts.map((c) => c.newPage()),
  )) as [Page, Page];
  try {
    await page.goto("/");
    await registerTestAccount(page, "音量接收端");
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill("200% 语音放大实测");
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    const code = (
      await page
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
    await speaker(quiet, "小声成员", code, 440);
    await expect(
      page.locator('audio[data-cinegather-audio="microphone"]'),
    ).toHaveCount(1);
    await speaker(normal, "正常成员", code, 660);
    await expect(
      page.locator('audio[data-cinegather-audio="microphone"]'),
    ).toHaveCount(2);
    await expect.poll(() => rms(page, 0)).toBeGreaterThan(0.005);
    await expect(
      page.locator("audio[data-cinegather-voice-input]"),
    ).toHaveCount(2);
    expect(
      await page
        .locator("audio[data-cinegather-voice-input]")
        .evaluateAll((elements) =>
          elements.every(
            (e) =>
              (e as HTMLMediaElement).muted &&
              (e as HTMLMediaElement).volume === 0,
          ),
        ),
    ).toBe(true);
    const baseline = await rms(page, 0),
      otherBaseline = await rms(page, 1);
    await volume(page, "小声成员", 200);
    await expect(page.locator(".member-volume-value")).toHaveText("200%");
    await page.getByRole("menuitem", { name: "添加好友", exact: true }).hover();
    await page.screenshot({ path: ".local/member-volume/menu-200.png" });
    await page.keyboard.press("Escape");
    const amplified = await rms(page, 0),
      otherAfter = await rms(page, 1);
    expect(amplified / baseline).toBeGreaterThan(1.85);
    expect(amplified / baseline).toBeLessThan(2.15);
    expect(otherAfter / otherBaseline).toBeGreaterThan(0.9);
    expect(otherAfter / otherBaseline).toBeLessThan(1.1);
    expect(
      await page
        .locator('audio[data-cinegather-audio="microphone"]')
        .first()
        .evaluate((e: HTMLMediaElement) => e.volume),
    ).toBe(1);
    await page.getByRole("menuitem", { name: /^我的房间/ }).click();
    await page
      .getByRole("button", { name: "返回当前房间", exact: true })
      .click();
    await page
      .getByRole("button", { name: "小声成员的成员操作", exact: true })
      .click();
    await expect(
      page.getByRole("slider", { name: "小声成员的音量", exact: true }),
    ).toHaveAttribute("aria-valuenow", "200");
    await page.keyboard.press("Escape");
    await page.getByRole("slider", { name: "语音音量", exact: true }).focus();
    await page.keyboard.press("Home");
    for (let n = 0; n < 10; n++) await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("slider", { name: "语音音量", exact: true }),
    ).toHaveAttribute("aria-valuenow", "10");
    // Master attenuation still applies after per-user amplification.
    expect((await rms(page, 0)) / baseline).toBeLessThan(0.25);
    await page
      .getByRole("slider", { name: "语音音量", exact: true })
      .press("End");
    await volume(page, "小声成员", 0);
    await page.keyboard.press("Escape");
    await expect.poll(() => rms(page, 0)).toBeLessThan(0.0001);
    expect(await rms(page, 1)).toBeGreaterThan(0.005);
    await volume(page, "小声成员", 200);
    await page.keyboard.press("Escape");
    await quiet
      .getByRole("button", { name: "关闭麦克风", exact: true })
      .click();
    await quiet
      .getByRole("button", { name: "开启麦克风", exact: true })
      .click();
    await expect.poll(() => rms(page, 0)).toBeGreaterThan(baseline * 1.8);
    const outputs = await page.evaluate(() => {
      const probe = (
        window as unknown as {
          voiceProbe: {
            outputs: MediaStreamAudioDestinationNode[];
          };
        }
      ).voiceProbe;
      const contexts = Array.from(
        document.querySelectorAll<HTMLAudioElement>(
          'audio[data-cinegather-audio="microphone"]',
        ),
      ).map(
        (e) => probe.outputs.find((o) => o.stream === e.srcObject)!.context,
      );
      Object.assign(window, { voiceContexts: contexts });
      return contexts.length;
    });
    expect(outputs).toBe(2);
    await page.evaluate(() =>
      (
        window as unknown as { voiceContexts: AudioContext[] }
      ).voiceContexts[0]!.suspend(),
    );
    await page
      .getByRole("button", { name: "点击启用房间声音", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "点击启用房间声音", exact: true }),
    ).toHaveCount(0);
    expect(
      await page
        .locator("audio[data-cinegather-voice-input]")
        .evaluateAll((elements) =>
          elements.every(
            (e) =>
              (e as HTMLMediaElement).muted &&
              (e as HTMLMediaElement).volume === 0,
          ),
        ),
    ).toBe(true);
    expect((await rms(page, 0)) / baseline).toBeGreaterThan(1.8);
    await page
      .getByRole("menuitem", { name: "设置与设备", exact: true })
      .click();
    await page.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await rms(page, 0)) / baseline).toBeGreaterThan(1.8);
    await leave(quiet);
    await expect(
      page.locator('audio[data-cinegather-audio="microphone"]'),
    ).toHaveCount(1);
    // A rejoining member gets the saved level on the replacement subscription.
    await quiet.getByRole("button", { name: "加入房间", exact: true }).click();
    await quiet.getByLabel("房间号或邀请链接").fill(code);
    await quiet.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(
      page.locator('audio[data-cinegather-audio="microphone"]'),
    ).toHaveCount(2);
    expect((await rms(page, 1)) / baseline).toBeGreaterThan(1.8);
    await leave(quiet);
    await leave(normal);
    await expect(
      page.locator('audio[data-cinegather-audio="microphone"]'),
    ).toHaveCount(0);
    await leave(page);
    await expect(
      page.locator("audio[data-cinegather-voice-input]"),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        (
          window as unknown as { voiceContexts: AudioContext[] }
        ).voiceContexts.every((c) => c.state === "closed"),
      ),
    ).toBe(true);
    console.log(
      JSON.stringify({
        voiceSampleRatio: amplified / baseline,
        otherSampleRatio: otherAfter / otherBaseline,
      }),
    );
  } finally {
    await leave(quiet);
    await leave(normal);
    await leave(page);
    for (const c of contexts) await c.close();
  }
});

test("friend volume is restored in real voice playback across clients, rooms, reloads and account changes", async ({
  page,
  context,
  browser,
  request,
}) => {
  test.setTimeout(150000);
  page.setDefaultTimeout(15000);
  const base = "http://127.0.0.1:14310/api/v1";
  const people: { id: string; username: string; token: string }[] = [],
    rooms: string[] = [];
  const speakerContext = await browser.newContext({
    permissions: ["microphone"],
  });
  const otherContext = await browser.newContext();
  const source = await speakerContext.newPage();
  const identity = async (p: Page) =>
    p.evaluate(async () => {
      const { state } = await import("/store.ts" as string);
      return {
        id: state().user.id as string,
        username: state().user.username as string,
        token: localStorage.getItem("cinegather.session")!,
      };
    });
  const saved = async (token: string, id: string) => {
    const response = await request.get(base + "/friends", {
      headers: { Authorization: "Bearer " + token },
    });
    expect(response.status()).toBe(200);
    return (await response.json()).items.find(
      (f: { userId: string }) => f.userId === id,
    )?.volume as number;
  };
  const joinCode = async (p: Page, code: string) => {
    await p.keyboard.press("Escape");
    await expect(p.getByRole("dialog")).toHaveCount(0);
    await p.getByRole("button", { name: "加入房间", exact: true }).click();
    await p.getByLabel("房间号或邀请链接").fill(code);
    await p.getByRole("button", { name: "进入房间", exact: true }).click();
    await expect(p.getByRole("dialog")).toHaveCount(0);
  };
  const create = async (name: string) => {
    await page
      .getByRole("button", { name: "创建私人房间", exact: true })
      .click();
    await page.getByLabel("房间名称").fill(name);
    await page.getByRole("button", { name: "创建并进入", exact: true }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { state } = await import("/store.ts" as string);
          return state().room?.id;
        }),
      )
      .toBeTruthy();
    rooms.push(
      await page.evaluate(async () => {
        const { state } = await import("/store.ts" as string);
        return state().room.id as string;
      }),
    );
    return (
      await page
        .getByRole("button", { name: "复制房间号", exact: true })
        .innerText()
    ).trim();
  };
  try {
    await context.grantPermissions(["microphone"]);
    await page.goto("/");
    await registerTestAccount(page, "音量记忆甲");
    people.push(await identity(page));
    const code = await create("音量记忆第一房");
    await speaker(source, "音量记忆好友", code, 440);
    people.push(await identity(source));
    const a = people[0]!,
      s = people[1]!;
    await request.post(base + "/friends", {
      headers: { Authorization: "Bearer " + a.token },
      data: { userId: s.id },
    });
    await request.post(base + `/friends/${a.id}/accept`, {
      headers: { Authorization: "Bearer " + s.token },
    });
    await page.evaluate(async () => {
      const actions = await import("/controller.ts" as string);
      await actions.refreshFriends();
    });
    await expect(
      page.locator('audio[data-cinegather-audio="microphone"]'),
    ).toHaveCount(1);
    await expect.poll(() => rms(page, 0)).toBeGreaterThan(0.005);
    const baseline = await rms(page, 0);
    await volume(page, "音量记忆好友", 200);
    await page.keyboard.press("Escape");
    await expect.poll(() => saved(a.token, s.id)).toBe(200);
    expect((await rms(page, 0)) / baseline).toBeGreaterThan(1.8);
    const { testPassword } = await import("./helpers/account");
    const secondLogin = await request.post(base + "/accounts/login", {
      data: { username: a.username, password: testPassword },
    });
    expect(secondLogin.status()).toBe(201);
    const secondToken = (await secondLogin.json()).sessionToken as string;
    await otherContext.addInitScript(
      (token) => localStorage.setItem("cinegather.session", token),
      secondToken,
    );
    const other = await otherContext.newPage();
    await other.goto("/");
    await expect
      .poll(() =>
        other.evaluate(async (id) => {
          const { state } = await import("/store.ts" as string);
          return state().memberVolumes[id];
        }, s.id),
      )
      .toBe(200);
    await other.evaluate(async (id) => {
      const actions = await import("/controller.ts" as string);
      await actions.updateFriendPreferences(id, { volume: 75 });
    }, s.id);
    await expect
      .poll(async () => (await rms(page, 0)) / baseline, { timeout: 15000 })
      .toBeLessThan(0.85);
    expect((await rms(page, 0)) / baseline).toBeGreaterThan(0.65);
    await volume(page, "音量记忆好友", 0);
    await page.keyboard.press("Escape");
    await expect.poll(() => saved(a.token, s.id)).toBe(0);
    await expect.poll(() => rms(page, 0)).toBeLessThan(0.0001);
    await leave(page);
    const code2 = await create("音量记忆第二房");
    await leave(source);
    await joinCode(source, code2);
    await expect(
      page.locator('audio[data-cinegather-audio="microphone"]'),
    ).toHaveCount(1);
    await expect.poll(() => rms(page, 0)).toBeLessThan(0.0001);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeVisible();
    await joinCode(page, code2);
    await expect(
      page.locator('audio[data-cinegather-audio="microphone"]'),
    ).toHaveCount(1);
    await expect.poll(() => rms(page, 0)).toBeLessThan(0.0001);
    await page
      .getByRole("button", { name: "音量记忆好友的成员操作", exact: true })
      .click();
    await expect(
      page.getByRole("slider", { name: "音量记忆好友的音量", exact: true }),
    ).toHaveAttribute("aria-valuenow", "0");
    await page.keyboard.press("Escape");
    const username =
        "vol_" + crypto.randomUUID().replaceAll("-", "").slice(0, 20),
      password = "Volume account fixture 123!";
    const response = await request.post(base + "/accounts/register", {
      data: { username, displayName: "音量记忆乙", password },
    });
    expect(response.status()).toBe(201);
    const account = await response.json();
    people.push({ id: account.user.id, username, token: account.sessionToken });
    await request.post(base + "/friends", {
      headers: { Authorization: "Bearer " + account.sessionToken },
      data: { userId: s.id },
    });
    await request.post(base + `/friends/${account.user.id}/accept`, {
      headers: { Authorization: "Bearer " + s.token },
    });
    await leave(page);
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.getByRole("tab", { name: "登录", exact: true }).click();
    await page.getByLabel("用户名", { exact: true }).fill(username);
    await page.getByLabel("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登录映聚", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { state } = await import("/store.ts" as string);
          return !state().busy && state().user?.displayName === "音量记忆乙";
        }),
      )
      .toBe(true);
    await expect(
      page.getByRole("button", { name: "退出登录", exact: true }),
    ).toBeVisible();
    await joinCode(page, code2);
    await expect(
      page.locator('audio[data-cinegather-audio="microphone"]'),
    ).toHaveCount(1);
    await expect.poll(() => rms(page, 0)).toBeGreaterThan(baseline * 0.8);
    expect((await rms(page, 0)) / baseline).toBeLessThan(1.2);
    expect(await saved(secondToken, s.id)).toBe(0);
    expect(await saved(account.sessionToken, s.id)).toBe(100);
  } catch (error) {
    console.error("Volume memory scenario failed", error);
    throw error;
  } finally {
    await leave(page).catch(() => {});
    await leave(source).catch(() => {});
    await otherContext.close();
    await speakerContext.close();
    if (people.length) {
      const { execFileSync } = await import("node:child_process");
      execFileSync(
        "bun",
        [
          "tests/e2e/helpers/cleanup-room-invitations.ts",
          JSON.stringify({ users: people.map((p) => p.id), rooms }),
        ],
        { stdio: "pipe" },
      );
    }
  }
});
