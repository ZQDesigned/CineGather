import {
  RnnoiseWorkletNode,
  loadRnnoise,
} from "@sapphi-red/web-noise-suppressor";
import workletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import wasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import simdUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";
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

// Own the 48 kHz context: RNNoise requires it even when the input/output device
// uses 44.1 kHz. Web Audio resamples at the MediaStream boundary. This graph has
// no connection to an audible destination, and never owns the raw mic track.
export class MicrophoneDenoiser
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  readonly name = "CineGather RNNoise";
  processedTrack?: MediaStreamTrack;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private destination?: MediaStreamAudioDestinationNode;
  private node?: RnnoiseWorkletNode;
  private generation = 0;
  constructor(
    private readonly status: (status: MicrophoneNoiseStatus) => void = () => {},
  ) {}

  async init(options: AudioProcessorOptions) {
    const generation = ++this.generation;
    await this.releaseGraph();
    if (generation !== this.generation) return;
    try {
      const context = new AudioContext({
        sampleRate: 48000,
        latencyHint: "interactive",
      });
      this.context = context;
      const wasmBinary = await loadBinary();
      if (generation !== this.generation) return;
      await context.audioWorklet.addModule(workletUrl);
      if (generation !== this.generation) return;
      // Compile once on this realm too, so an invalid binary/CSP denial is a
      // recoverable init error rather than an asynchronously silent worklet.
      await WebAssembly.compile(wasmBinary);
      if (generation !== this.generation) return;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          context.resume(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Audio context did not start")),
              3000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      if (generation !== this.generation) return;
      this.source = context.createMediaStreamSource(
        new MediaStream([options.track]),
      );
      this.destination = context.createMediaStreamDestination();
      this.destination.channelCount = 1;
      this.node = new RnnoiseWorkletNode(context, {
        wasmBinary,
        maxChannels: 1,
      });
      this.node.channelCount = 1;
      this.node.channelCountMode = "explicit";
      this.source.connect(this.node).connect(this.destination);
      this.processedTrack = this.destination.stream.getAudioTracks()[0];
      this.node.onprocessorerror = () => {
        if (generation !== this.generation) return;
        void this.fallback(
          options.track,
          "AudioWorklet processing failed",
          generation,
        );
      };
      this.status({ requested: "enhanced", active: "enhanced" });
    } catch (error) {
      if (generation !== this.generation) return;
      await this.fallback(
        options.track,
        error instanceof Error
          ? error.message
          : "RNNoise initialization failed",
        generation,
      );
      // No output graph exists after an init failure: let LiveKit send the raw
      // track with the platform's basic suppression instead.
      if (!this.processedTrack) await this.releaseGraph();
    }
  }
  private async fallback(
    track: MediaStreamTrack,
    reason: string,
    generation: number,
  ) {
    if (generation !== this.generation) return;
    this.source?.disconnect();
    this.node?.destroy();
    this.node?.disconnect();
    this.node = undefined;
    // Runtime failure keeps the already-published output alive via bypass.
    if (this.source && this.destination) this.source.connect(this.destination);
    await track
      .applyConstraints({ ...track.getConstraints(), noiseSuppression: true })
      .catch(() => {});
    if (generation === this.generation)
      this.status({ requested: "enhanced", active: "basic", reason });
  }
  async restart(options: AudioProcessorOptions) {
    await this.init(options);
  }
  private async releaseGraph() {
    this.node?.destroy();
    this.node?.disconnect();
    this.node = undefined;
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
