import {
  RnnoiseWorkletNode,
  loadRnnoise,
} from "@sapphi-red/web-noise-suppressor";
import workletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import wasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import simdUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
import { createDeepFilterNetAudioWorklet } from "@workadventure/noise-suppression/deepfilternet";
import type {
  AudioProcessorOptions,
  Track,
  TrackProcessor,
} from "livekit-client";
import type { MicrophoneNoiseStatus } from "./noise";

let binary: Promise<ArrayBuffer> | undefined;
function loadBinary() {
  return (binary ??= loadRnnoise(
    { url: wasmUrl, simdUrl },
    { signal: AbortSignal.timeout(8000) },
  ).catch((error) => {
    binary = undefined;
    throw error;
  }));
}
async function bounded<T>(
  promise: Promise<T>,
  milliseconds: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Noise processor initialization timed out")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Only microphone speech passes through this graph. It never connects to the
// speakers and never owns the caller's microphone track or AudioContext.
export class MicrophoneDenoiser
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  readonly name = "CineGather DeepFilterNet3";
  processedTrack?: MediaStreamTrack;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private destination?: MediaStreamAudioDestinationNode;
  private node?: AudioWorkletNode;
  private disposeFilter?: () => void;
  private filterEvents?: AbortController;
  private generation = 0;
  private degrading = false;
  constructor(
    private readonly status: (status: MicrophoneNoiseStatus) => void = () => {},
  ) {}

  async init(options: AudioProcessorOptions) {
    const generation = ++this.generation;
    await this.releaseGraph();
    if (generation !== this.generation) return;
    this.degrading = false;
    try {
      const context = new AudioContext({
        sampleRate: 48000,
        latencyHint: "interactive",
      });
      this.context = context;
      await bounded(context.resume(), 3000);
      if (generation !== this.generation) return;
      this.source = context.createMediaStreamSource(
        new MediaStream([options.track]),
      );
      this.destination = context.createMediaStreamDestination();
      this.destination.channelCount = 1;
      this.processedTrack = this.destination.stream.getAudioTracks()[0];
      let abandoned = false;
      const loading = createDeepFilterNetAudioWorklet(context, {
        speechAttenuationDb: 35,
        pauseAttenuationDb: 55,
        minSpeechFrames: 2,
        pauseGateLookaheadFrames: 3,
        postGain: { maxGainDb: 9 },
        bypassUntilReady: false,
        readyTimeoutMs: 8000,
        onOverload: () => {
          void this.compatibility(
            options.track,
            "deepfilternet-overloaded",
            generation,
          );
        },
      });
      // The vendor's asset loader is not abortable. A node that arrives after
      // timeout/cancellation must be disposed instead of reconnecting the mic.
      void loading.then(
        (handle) => {
          void handle.ready.catch(() => {});
          if (abandoned || generation !== this.generation) handle.dispose();
        },
        () => {},
      );
      let handle: Awaited<typeof loading>;
      try {
        handle = await bounded(loading, 12000);
      } catch (error) {
        abandoned = true;
        throw error;
      }
      if (generation !== this.generation) return;
      this.connect(handle.node, () => handle.dispose());
      await handle.ready;
      if (generation !== this.generation || this.degrading) return;
      await options.track
        .applyConstraints({
          ...options.track.getConstraints(),
          noiseSuppression: false,
          autoGainControl: false,
        })
        .catch(() => {});
      if (generation !== this.generation || this.degrading) return;
      handle.node.addEventListener(
        "processorerror",
        () => {
          void this.compatibility(
            options.track,
            "deepfilternet-processing-failed",
            generation,
          );
        },
        { signal: this.filterEvents!.signal },
      );
      handle.node.port.addEventListener(
        "message",
        (event) => {
          if (event.data?.type === "error")
            void this.compatibility(
              options.track,
              "deepfilternet-processing-failed",
              generation,
            );
        },
        { signal: this.filterEvents!.signal },
      );
      this.status({
        requested: "enhanced",
        active: "enhanced",
        engine: "deepfilternet3",
      });
    } catch {
      await this.compatibility(
        options.track,
        "deepfilternet-initialization-failed",
        generation,
      );
      if (generation === this.generation && !this.processedTrack)
        await this.releaseGraph();
    }
  }
  private connect(node: AudioWorkletNode, dispose: () => void) {
    this.bypass();
    this.node = node;
    this.disposeFilter = dispose;
    this.filterEvents = new AbortController();
    node.channelCount = 1;
    node.channelCountMode = "explicit";
    this.source!.disconnect();
    this.source!.connect(node).connect(this.destination!);
  }
  private bypass() {
    this.filterEvents?.abort();
    this.filterEvents = undefined;
    this.disposeFilter?.();
    this.disposeFilter = undefined;
    this.node?.disconnect();
    this.node = undefined;
    this.source?.disconnect();
    if (this.source && this.destination) this.source.connect(this.destination);
  }
  private async basic(
    track: MediaStreamTrack,
    reason: string,
    generation: number,
  ) {
    if (generation !== this.generation) return;
    this.bypass();
    await track
      .applyConstraints({
        ...track.getConstraints(),
        noiseSuppression: true,
        autoGainControl: true,
      })
      .catch(() => {});
    if (generation === this.generation)
      this.status({
        requested: "enhanced",
        active: "basic",
        engine: "platform",
        reason,
      });
  }
  private async compatibility(
    track: MediaStreamTrack,
    reason: string,
    generation: number,
  ) {
    if (generation !== this.generation || this.degrading) return;
    this.degrading = true;
    await this.basic(track, reason, generation);
    try {
      const context = this.context;
      if (
        !context ||
        !this.source ||
        !this.destination ||
        generation !== this.generation
      )
        return;
      const wasmBinary = await loadBinary();
      if (generation !== this.generation) return;
      await bounded(context.audioWorklet.addModule(workletUrl), 5000);
      await bounded(WebAssembly.compile(wasmBinary), 3000);
      if (generation !== this.generation) return;
      const node = new RnnoiseWorkletNode(context, {
        wasmBinary,
        maxChannels: 1,
      });
      this.connect(node, () => node.destroy());
      node.addEventListener(
        "processorerror",
        () => {
          void this.basic(track, "rnnoise-processing-failed", generation);
        },
        { signal: this.filterEvents!.signal },
      );
      this.status({
        requested: "enhanced",
        active: "enhanced",
        engine: "rnnoise",
        reason,
      });
    } catch {
      await this.basic(track, "enhancement-unavailable", generation);
    }
  }
  async restart(options: AudioProcessorOptions) {
    await this.init(options);
  }
  private async releaseGraph() {
    this.bypass();
    this.source?.disconnect();
    this.source = undefined;
    this.processedTrack?.stop();
    this.processedTrack = undefined;
    this.destination?.stream.getTracks().forEach((track) => track.stop());
    this.destination?.disconnect();
    this.destination = undefined;
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== "closed") await context.close();
  }
  async destroy() {
    ++this.generation;
    await this.releaseGraph();
  }
}
