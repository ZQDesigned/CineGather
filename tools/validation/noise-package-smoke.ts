import { _electron as electron, expect } from "@playwright/test";
import {
  mkdtemp,
  readdir,
  writeFile,
  rm,
  mkdir,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

if (!["darwin", "win32"].includes(process.platform))
  throw Error("Run the packaged noise test on Mac or Windows");
const { version } = JSON.parse(
  await readFile("apps/desktop/package.json", "utf8"),
);
const profile = await mkdtemp(join(tmpdir(), "cg-noise-package-"));
const modules = await readdir("apps/desktop/out/renderer/assets");
const moduleName = modules.find((name) =>
  /^noise-processor-.*\.js$/.test(name),
);
if (!moduleName) throw Error("No built noise processor");
await writeFile(
  join(profile, "settings.json"),
  JSON.stringify({
    minimizeToTray: false,
    pushToTalk: false,
    pttShortcut: "Control+Alt+Shift+F12",
    muteShortcut: "Control+Alt+Shift+F11",
    quality: "cinema",
    inputDevice: "",
    outputDevice: "",
  }),
);
const executablePath = resolve(
  "apps/desktop/release",
  process.platform === "win32"
    ? "win-unpacked/CineGather.exe"
    : "mac-arm64/CineGather.app/Contents/MacOS/CineGather",
);
const app = await electron.launch({
  executablePath,
  args: [
    `--user-data-dir=${profile}`,
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
  ],
  timeout: 30000,
});
try {
  expect(await app.evaluate(({ app }) => app.getVersion())).toBe(version);
  const page = await app.firstWindow();
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  const result = await page.evaluate(async (file) => {
    const loaded: Record<string, unknown> = await import(
      new URL("assets/" + file, location.href).href
    );
    type Status = { active: string; engine?: string };
    type Processor = {
      processedTrack?: MediaStreamTrack;
      init(options: {
        kind: string;
        track: MediaStreamTrack;
        audioContext: AudioContext;
      }): Promise<void>;
      destroy(): Promise<void>;
    };
    const Denoiser = Object.values(loaded).find(
      (value) =>
        typeof value === "function" &&
        value.prototype.init &&
        value.prototype.destroy,
    ) as new (status: (value: Status) => void) => Processor;
    if (!Denoiser) throw Error("No processor export");
    const context = new AudioContext({ sampleRate: 44100 });
    await context.resume();
    const noise = context.createBuffer(1, 44100 * 3, 44100),
      values = noise.getChannelData(0);
    let seed = 42,
      smooth = 0;
    for (let i = 0; i < values.length; i++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      smooth = 0.95 * smooth + 0.05 * (seed / 2147483648 - 1);
      values[i] = smooth * 0.08;
    }
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const destination = context.createMediaStreamDestination();
    source.connect(destination);
    source.start();
    const track = destination.stream.getAudioTracks()[0]!;
    const statuses: Status[] = [];
    const processor = new Denoiser((value) => statuses.push(value));
    try {
      await processor.init({ kind: "audio", track, audioContext: context });
      const output = processor.processedTrack;
      if (!output) throw Error("No output");
      const nodes = [track, output].map((t) => {
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        const node = context.createMediaStreamSource(new MediaStream([t]));
        node.connect(analyser);
        return { node, analyser };
      });
      await new Promise((r) => setTimeout(r, 3500));
      const power = [0, 0],
        buffer = new Float32Array(2048);
      for (let n = 0; n < 25; n++) {
        for (let i = 0; i < 2; i++) {
          nodes[i]!.analyser.getFloatTimeDomainData(buffer);
          power[i]! +=
            buffer.reduce((sum, v) => sum + v * v, 0) / buffer.length;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      nodes.forEach((node) => node.node.disconnect());
      await processor.destroy();
      return {
        statuses,
        rawPower: power[0]!,
        attenuationDb: 10 * Math.log10(power[0]! / Math.max(power[1]!, 1e-12)),
        inputState: track.readyState,
        outputState: output.readyState,
      };
    } finally {
      await processor.destroy();
      source.stop();
      track.stop();
      await context.close();
    }
  }, moduleName);
  expect(result.statuses.at(-1)).toMatchObject({
    active: "enhanced",
    engine: "deepfilternet3",
  });
  expect(result.rawPower).toBeGreaterThan(0.0001);
  expect(result.attenuationDb).toBeGreaterThan(20);
  expect(result.inputState).toBe("live");
  expect(result.outputState).toBe("ended");
  await mkdir(".local/noise-verification", { recursive: true });
  await writeFile(
    `.local/noise-verification/${process.platform}.json`,
    JSON.stringify({ version, ...result }, null, 2),
  );
  console.log("Packaged offline DeepFilterNet3", {
    platform: process.platform,
    version,
    ...result,
  });
} finally {
  await app.close();
  await rm(profile, { recursive: true, force: true });
}
