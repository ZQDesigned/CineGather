import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
export async function benchmarkBasicNoise(
  page: Page,
  options: { broadband?: boolean; voiceGain?: number } = {},
) {
  const bytes = [
    ...(await readFile(resolve("tests/fixtures/microphone-voice.wav"))),
  ];
  return page.evaluate(
    async ({ bytes, module, recordingModule, options }) => {
      const { createMicrophoneProcessor } = await import(module);
      const context = new AudioContext({ sampleRate: 44100 });
      await context.resume();
      const speech = await context.decodeAudioData(
          new Uint8Array(bytes).buffer,
        ),
        reference = context.createBuffer(1, 48000 * 9, 48000),
        noisy = context.createBuffer(1, 48000 * 9, 48000);
      // decodeAudioData follows the caller clock; resample the clean reference onto
      // the measured filter clock before mixing the controlled environmental noise.
      const resampler = new OfflineAudioContext(
          1,
          Math.ceil(speech.duration * 48000),
          48000,
        ),
        rs = resampler.createBufferSource();
      rs.buffer = speech;
      rs.connect(resampler.destination);
      rs.start();
      const voice = await resampler.startRendering();
      reference.getChannelData(0).set(
        voice
          .getChannelData(0)
          .slice(0, 48000 * 5)
          .map((x) => x * (options.voiceGain ?? 0.3)),
        48000 * 3,
      );
      let seed = 2026,
        fan = 0;
      const clean = reference.getChannelData(0),
        mixed = noisy.getChannelData(0);
      for (let i = 0; i < mixed.length; i++) {
        seed = (1664525 * seed + 1013904223) >>> 0;
        const white = seed / 2147483648 - 1;
        fan = 0.97 * fan + 0.03 * white;
        const attack = i % 7680,
          key = attack < 1200 ? Math.exp(-attack / 180) * white * 0.32 : 0;
        mixed[i] =
          clean[i]! +
          (options.broadband
            ? fan * 0.16 +
              white * 0.015 +
              Math.sin((i * Math.PI * 2 * 50) / 48000) * 0.004
            : fan * 0.16 + key);
      }
      const input = context.createMediaStreamDestination(),
        track = input.stream.getAudioTracks()[0]!,
        statuses: {
          requested: string;
          active: string;
          engine?: string;
          reason?: string;
        }[] = [],
        processor = await createMicrophoneProcessor(
          "basic",
          "none",
          (s: {
            requested: string;
            active: string;
            engine?: string;
            reason?: string;
          }) => statuses.push(s),
        );
      const connected: {
        source: MediaStreamAudioSourceNode;
        filter: AudioWorkletNode;
      }[] = [];
      const connect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (
        this: AudioNode,
        ...args: Parameters<typeof connect>
      ) {
        if (
          this instanceof MediaStreamAudioSourceNode &&
          this.mediaStream.getAudioTracks().some((t) => t.id === track.id) &&
          args[0] instanceof AudioWorkletNode
        )
          connected.push({ source: this, filter: args[0] });
        return Reflect.apply(connect, this, args);
      } as typeof connect;
      let recorder: AudioWorkletNode | undefined,
        merger: ChannelMergerNode | undefined,
        raw: AudioBufferSourceNode | undefined,
        ref: AudioBufferSourceNode | undefined;
      try {
        try {
          await processor.init({ kind: "audio", track, audioContext: context });
        } finally {
          AudioNode.prototype.connect = connect;
        }
        const connection = connected.at(-1);
        if (!connection)
          throw Error("Basic mode did not install a neural noise filter");
        const clock = connection.filter.context as AudioContext;
        connection.source.disconnect();
        raw = clock.createBufferSource();
        ref = clock.createBufferSource();
        raw.buffer = noisy;
        ref.buffer = reference;
        raw.connect(connection.filter);
        await clock.audioWorklet.addModule(recordingModule);
        recorder = new AudioWorkletNode(clock, "test-audio-recording", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 3,
          channelCountMode: "explicit",
          channelInterpretation: "discrete",
          processorOptions: { frames: 48000 * 9.4 },
        });
        merger = clock.createChannelMerger(3);
        ref.connect(merger, 0, 0);
        raw.connect(merger, 0, 1);
        connection.filter.connect(merger, 0, 2);
        merger.connect(recorder);
        const chunks: Float32Array[][] = [[], [], []];
        const done = new Promise<void>((resolve, reject) => {
          recorder!.onprocessorerror = () =>
            reject(Error("Recording worklet failed"));
          recorder!.port.onmessage = (
            e: MessageEvent<{ type: string; channels?: Float32Array[] }>,
          ) => {
            if (e.data.type === "done") resolve();
            else e.data.channels?.forEach((x, i) => chunks[i]!.push(x));
          };
        });
        recorder.connect(clock.destination);
        const when = clock.currentTime + 0.1;
        raw.start(when);
        ref.start(when);
        await done;
        const data = chunks.map((parts) => {
          const x = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
          let at = 0;
          for (const p of parts) {
            x.set(p, at);
            at += p.length;
          }
          return x;
        });
        if (data.some((x) => x.length !== 48000 * 9.4))
          throw Error("Incomplete audio-thread recording");
        function score(channel: number, lag: number) {
          let rp = 0,
            op = 0,
            cross = 0;
          for (let i = 0; i < data[0]!.length - 9000; i += 8) {
            const ref = data[0]![i]!;
            if (Math.abs(ref) < 0.0001) continue;
            const value = data[channel]![i + lag]!;
            rp += ref * ref;
            op += value * value;
            cross += ref * value;
          }
          const wanted = (cross * cross) / Math.max(rp, 1e-12);
          return {
            db: 10 * Math.log10(wanted / Math.max(op - wanted, 1e-12)),
            gain: cross / Math.max(rp, 1e-12),
          };
        }
        const before = score(1, 0);
        let best = { db: -Infinity, gain: 0 },
          lag = 0;
        for (let offset = 0; offset <= 4800; offset += 4) {
          const s = score(2, offset);
          if (s.db > best.db) {
            best = s;
            lag = offset;
          }
        }
        const coarse = lag;
        for (
          let offset = Math.max(0, coarse - 4);
          offset <= coarse + 4;
          offset++
        ) {
          const s = score(2, offset);
          if (s.db > best.db) {
            best = s;
            lag = offset;
          }
        }
        let noiseIn = 0,
          noiseOut = 0;
        for (let i = 48000; i < 48000 * 2.5; i++) {
          noiseIn += data[1]![i]! ** 2;
          noiseOut += data[2]![i + lag]! ** 2;
        }
        return {
          statuses,
          beforeDb: before.db,
          afterDb: best.db,
          improvementDb: best.db - before.db,
          speechGain: best.gain,
          attenuationDb: 10 * Math.log10(noiseIn / Math.max(noiseOut, 1e-12)),
          delayMs: lag / 48,
          filterSampleRate: clock.sampleRate,
          callerSampleRate: context.sampleRate,
          inputState: track.readyState,
        };
      } finally {
        AudioNode.prototype.connect = connect;
        raw?.disconnect();
        ref?.disconnect();
        recorder?.disconnect();
        recorder?.port.close();
        merger?.disconnect();
        await processor.destroy();
        track.stop();
        await context.close();
      }
    },
    {
      bytes,
      options,
      module: `/@fs${resolve("packages/media-core/src/microphone-processor.ts")}`,
      recordingModule: `/@fs${resolve("tests/fixtures/audio-recording-worklet.js")}`,
    },
  );
}
