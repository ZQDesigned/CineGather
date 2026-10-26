import { test, expect } from "@playwright/test";
import { resolve } from "node:path";

const processorModule = `/@fs${resolve("packages/media-core/src/noise-processor.ts")}`;
test("DeepFilterNet3 attenuates stationary fan-like noise in the actual AudioWorklet, resamples 44.1k input and releases its output", async ({
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
    const statuses: { active: string; engine?: string; reason?: string }[] = [];
    const processor = new MicrophoneDenoiser(
      (status: { active: string; engine?: string; reason?: string }) =>
        statuses.push(status),
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
  expect(result.statuses.at(-1)).toMatchObject({
    active: "enhanced",
    engine: "deepfilternet3",
  });
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
    const statuses: { active: string; engine?: string; reason?: string }[] = [];
    const processor = new MicrophoneDenoiser(
      (status: { active: string; engine?: string; reason?: string }) =>
        statuses.push(status),
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

test("mixed quiet speech and keyboard-like transients improve without excessive voice delay", async ({
  page,
}) => {
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
      const speech = await context.decodeAudioData(
        new Uint8Array(bytes).buffer,
      );
      const samples = 48000 * 9;
      const reference = context.createBuffer(1, samples, 48000);
      const noisy = context.createBuffer(1, samples, 48000);
      const clean = reference.getChannelData(0),
        mixed = noisy.getChannelData(0);
      clean.set(
        speech.getChannelData(0).map((v) => v * 0.3),
        48000 * 3,
      );
      let seed = 2026,
        fan = 0;
      for (let i = 0; i < samples; i++) {
        seed = (1664525 * seed + 1013904223) >>> 0;
        const white = seed / 2147483648 - 1;
        fan = fan * 0.97 + white * 0.03;
        const attack = i % 7680;
        const key = attack < 1200 ? Math.exp(-attack / 180) * white * 0.32 : 0;
        mixed[i] = clean[i]! + fan * 0.16 + key;
      }
      const input = context.createMediaStreamDestination();
      const rawSource = context.createBufferSource(),
        referenceSource = context.createBufferSource();
      rawSource.buffer = noisy;
      referenceSource.buffer = reference;
      rawSource.connect(input);
      const inputTrack = input.stream.getAudioTracks()[0]!;
      const processor = new MicrophoneDenoiser();
      const chunks: Float32Array[][] = [[], [], []];
      const recorder = context.createScriptProcessor(2048, 3, 1);
      const merger = context.createChannelMerger(3);
      try {
        await processor.init({
          kind: "audio",
          track: inputTrack,
          audioContext: context,
        });
        if (!processor.processedTrack) throw Error("No enhancement output");
        referenceSource.connect(merger, 0, 0);
        rawSource.connect(merger, 0, 1);
        const filtered = context.createMediaStreamSource(
          new MediaStream([processor.processedTrack]),
        );
        filtered.connect(merger, 0, 2);
        merger.connect(recorder);
        recorder.onaudioprocess = (event) => {
          for (let i = 0; i < 3; i++)
            chunks[i]!.push(
              new Float32Array(event.inputBuffer.getChannelData(i)),
            );
          event.outputBuffer.getChannelData(0).fill(0); // Measure without speaker output.
        };
        recorder.connect(context.destination);
        const when = context.currentTime + 0.1;
        rawSource.start(when);
        referenceSource.start(when);
        await new Promise((r) => setTimeout(r, 9400));
        const data = chunks.map((parts) => {
          const combined = new Float32Array(
            parts.reduce((n, p) => n + p.length, 0),
          );
          let offset = 0;
          for (const p of parts) {
            combined.set(p, offset);
            offset += p.length;
          }
          return combined;
        });
        function score(channel: number, lag: number) {
          let refPower = 0,
            signalPower = 0,
            cross = 0;
          for (let i = 0; i < data[0]!.length - 9000; i += 8) {
            const ref = data[0]![i]!;
            if (Math.abs(ref) < 0.0001) continue;
            const value = data[channel]![i + lag]!;
            refPower += ref * ref;
            signalPower += value * value;
            cross += ref * value;
          }
          const wanted = (cross * cross) / Math.max(refPower, 1e-12);
          return (
            10 * Math.log10(wanted / Math.max(signalPower - wanted, 1e-12))
          );
        }
        const before = score(1, 0);
        let after = -Infinity,
          delay = 0;
        for (let lag = 0; lag <= 8640; lag += 4) {
          const value = score(2, lag);
          if (value > after) {
            after = value;
            delay = lag / 48;
          }
        }
        const coarse = Math.round(delay * 48);
        for (let lag = Math.max(0, coarse - 4); lag <= coarse + 4; lag++) {
          const value = score(2, lag);
          if (value > after) {
            after = value;
            delay = lag / 48;
          }
        }
        return {
          beforeDb: before,
          afterDb: after,
          improvementDb: after - before,
          delayMs: delay,
          audio: data.map((samples) => {
            const bytes = new Uint8Array(samples.buffer);
            let text = "";
            for (let offset = 0; offset < bytes.length; offset += 16384)
              text += String.fromCharCode(
                ...bytes.subarray(offset, offset + 16384),
              );
            return btoa(text);
          }),
        };
      } finally {
        recorder.disconnect();
        merger.disconnect();
        rawSource.stop();
        referenceSource.stop();
        await processor.destroy();
        inputTrack.stop();
        await context.close();
      }
    },
    { module: processorModule, bytes },
  );
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(".local/upgrade-presence-noise/audio", { recursive: true });
  for (let i = 0; i < result.audio.length; i++)
    await writeFile(
      `.local/upgrade-presence-noise/audio/channel-${i}.f32`,
      Buffer.from(result.audio[i]!, "base64"),
    );
  const metrics = {
    beforeDb: result.beforeDb,
    afterDb: result.afterDb,
    improvementDb: result.improvementDb,
    delayMs: result.delayMs,
  };
  console.log("Mixed speech enhancement", metrics);
  expect(result.improvementDb).toBeGreaterThan(3);
  expect(result.delayMs).toBeLessThan(180);
});

test("a failed high-quality model uses RNNoise and a later worklet error keeps the published output alive", async ({
  page,
}) => {
  await page.route("**/DeepFilterNet3*", (route) => route.abort("failed"));
  await page.goto("/");
  await page.getByRole("menuitem", { name: "设置与设备", exact: true }).click();
  const result = await page.evaluate(async (module) => {
    const { MicrophoneDenoiser } = await import(module);
    const context = new AudioContext({ sampleRate: 48000 });
    await context.resume();
    const track = context
      .createMediaStreamDestination()
      .stream.getAudioTracks()[0]!;
    const statuses: { active: string; engine?: string }[] = [];
    const processor = new MicrophoneDenoiser(
      (status: { active: string; engine?: string }) => statuses.push(status),
    );
    try {
      await processor.init({ kind: "audio", track, audioContext: context });
      const initial = statuses.at(-1);
      const output = processor.processedTrack;
      if (!output) throw Error("No fallback output");
      const errorNode = (processor as unknown as { node: AudioWorkletNode })
        .node;
      errorNode.dispatchEvent(
        new ErrorEvent("processorerror", {
          message: "fixture processor failure",
        }),
      );
      await new Promise((r) => setTimeout(r, 500));
      return {
        initial,
        final: statuses.at(-1),
        outputState: output.readyState,
        sameOutput: output === processor.processedTrack,
        inputState: track.readyState,
      };
    } finally {
      await processor.destroy();
      track.stop();
      await context.close();
    }
  }, processorModule);
  console.log("Fallback chain", result);
  expect(result.initial).toMatchObject({
    active: "enhanced",
    engine: "rnnoise",
  });
  expect(result.final).toMatchObject({ active: "basic", engine: "platform" });
  expect(result.outputState).toBe("live");
  expect(result.inputState).toBe("live");
  expect(result.sameOutput).toBe(true);
});
