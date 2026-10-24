import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

const processorModule = `/@fs${resolve("packages/media-core/src/noise-processor.ts")}`;
test("RNNoise attenuates stationary fan-like noise in the actual AudioWorklet, resamples 44.1k input and releases its output", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  const result = await page.evaluate(async (module) => {
    const { MicrophoneDenoiser } = await import(module);
    const context = new AudioContext({ sampleRate: 44100 });
    await context.resume();
    const noise = context.createBuffer(1, 44100 * 3, 44100);
    let seed = 42;
    let smooth = 0;
    const values = noise.getChannelData(0);
    for (let i = 0; i < values.length; i++) {
      seed = (1664525 * seed + 1013904223) >>> 0;
      // Low-frequency stationary noise represents a nearby fan, not speech.
      smooth = 0.95 * smooth + 0.05 * ((seed / 4294967296) * 2 - 1);
      values[i] = smooth * 0.08;
    }
    const source = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const input = context.createMediaStreamDestination();
    source.connect(input);
    source.start();
    const track = input.stream.getAudioTracks()[0]!;
    const statuses: { active: string; reason?: string }[] = [];
    const processor = new MicrophoneDenoiser(
      (status: { active: string; reason?: string }) => statuses.push(status),
    );
    try {
      await processor.init({ kind: "audio", track, audioContext: context });
      const filtered = processor.processedTrack as MediaStreamTrack;
      if (!filtered) throw new Error("No processed audio track");
      const measure = (t: MediaStreamTrack) => {
        const analyser = context.createAnalyser();
        analyser.fftSize = 2048;
        const node = context.createMediaStreamSource(new MediaStream([t]));
        node.connect(analyser);
        return { analyser, node };
      };
      const raw = measure(track),
        clean = measure(filtered);
      await new Promise((r) => setTimeout(r, 4000));
      let rawPower = 0,
        cleanPower = 0;
      const samples = new Float32Array(2048);
      for (let n = 0; n < 20; n++) {
        raw.analyser.getFloatTimeDomainData(samples);
        rawPower += samples.reduce((sum, x) => sum + x * x, 0) / samples.length;
        clean.analyser.getFloatTimeDomainData(samples);
        cleanPower +=
          samples.reduce((sum, x) => sum + x * x, 0) / samples.length;
        await new Promise((r) => setTimeout(r, 20));
      }
      raw.node.disconnect();
      clean.node.disconnect();
      const outputRate = filtered.getSettings().sampleRate;
      await processor.destroy();
      return {
        attenuationDb: 10 * Math.log10(rawPower / Math.max(cleanPower, 1e-12)),
        rawPower,
        statuses,
        outputRate,
        ended: filtered.readyState,
        inputState: track.readyState,
      };
    } finally {
      await processor.destroy();
      source.stop();
      track.stop();
      await context.close();
    }
  }, processorModule);
  console.log("RNNoise fan measurement", result);
  expect(result.rawPower).toBeGreaterThan(0.0001);
  expect(result.statuses.at(-1)?.active).toBe("enhanced");
  expect(result.outputRate).toBe(48000);
  expect(result.attenuationDb).toBeGreaterThan(10);
  expect(result.ended).toBe("ended");
  expect(result.inputState).toBe("live");
});

test("a failed model load falls back without stopping the microphone or its caller-owned context", async ({
  page,
}) => {
  await page.route("**/*.wasm*", async (route) => {
    if (route.request().resourceType() === "fetch") await route.abort("failed");
    else await route.continue();
  });
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  const result = await page.evaluate(async (module) => {
    const { MicrophoneDenoiser } = await import(module);
    const context = new AudioContext();
    await context.resume();
    const stream = context.createMediaStreamDestination().stream;
    const statuses: { active: string; reason?: string }[] = [];
    const processor = new MicrophoneDenoiser(
      (status: { active: string; reason?: string }) => statuses.push(status),
    );
    try {
      await processor.init({
        kind: "audio",
        track: stream.getAudioTracks()[0]!,
        audioContext: context,
      });
      await processor.destroy();
      return {
        statuses,
        input: stream.getAudioTracks()[0]!.readyState,
        callerContext: context.state,
      };
    } finally {
      await processor.destroy();
      stream.getTracks().forEach((t) => t.stop());
      await context.close();
    }
  }, processorModule);
  console.log("fallback measurement", result);
  expect(result.statuses.at(-1)?.active).toBe("basic");
  expect(result.statuses.at(-1)?.reason).toBeTruthy();
  expect(result.input).toBe("live");
  expect(result.callerContext).toBe("running");
});

test("enhancement preserves speech energy rather than passing the noise test by silencing all input", async ({
  page,
}) => {
  // Synthesized locally for this test; this contains no recorded user audio.
  const { readFile } = await import("node:fs/promises");
  const bytes = [
    ...(await readFile(resolve("tests/fixtures/microphone-voice.wav"))),
  ];
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  const result = await page.evaluate(
    async ({ module, bytes }) => {
      const { MicrophoneDenoiser } = await import(module);
      const context = new AudioContext({ sampleRate: 48000 });
      await context.resume();
      const buffer = await context.decodeAudioData(
        new Uint8Array(bytes).buffer,
      );
      const source = context.createBufferSource();
      source.buffer = buffer;
      const destination = context.createMediaStreamDestination();
      source.connect(destination);
      const track = destination.stream.getAudioTracks()[0]!;
      const processor = new MicrophoneDenoiser();
      try {
        await processor.init({ kind: "audio", track, audioContext: context });
        const output = processor.processedTrack;
        if (!output) throw new Error("Speech enhancement did not initialize");
        const nodes = [track, output].map((t) => {
          const analyser = context.createAnalyser();
          analyser.fftSize = 2048;
          const node = context.createMediaStreamSource(new MediaStream([t]));
          node.connect(analyser);
          return { node, analyser };
        });
        source.start();
        await new Promise((r) => setTimeout(r, 300));
        const power = [0, 0],
          values = new Float32Array(2048);
        for (let n = 0; n < 100; n++) {
          for (let i = 0; i < 2; i++) {
            nodes[i]!.analyser.getFloatTimeDomainData(values);
            power[i]! +=
              values.reduce((sum, x) => sum + x * x, 0) / values.length;
          }
          await new Promise((r) => setTimeout(r, 20));
        }
        nodes.forEach((n) => n.node.disconnect());
        return {
          inputPower: power[0]!,
          gain: Math.sqrt(power[1]! / power[0]!),
        };
      } finally {
        await processor.destroy();
        source.stop();
        track.stop();
        await context.close();
      }
    },
    { module: processorModule, bytes },
  );
  console.log("Speech energy preservation", result);
  expect(result.inputPower).toBeGreaterThan(0.001);
  expect(result.gain).toBeGreaterThan(0.35);
  expect(result.gain).toBeLessThan(2);
});
