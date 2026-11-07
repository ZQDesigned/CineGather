import type {
  AudioProcessorOptions,
  Track,
  TrackProcessor,
} from "livekit-client";
type Inner = TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> & {
  setMuted?(value: boolean): void;
  setStrength?(value: number): void;
};
export const microphoneInputVolume = (value: number) =>
  Number.isFinite(value) ? Math.round(Math.max(0, Math.min(200, value))) : 100;
export function createMicrophoneInputGraph(
  context: BaseAudioContext,
  source: AudioNode,
  volume = 100,
  muted = false,
) {
  const gain = context.createGain(),
    gate = context.createGain(),
    limiter = context.createDynamicsCompressor();
  gain.gain.value = microphoneInputVolume(volume) / 100;
  gate.gain.value = muted ? 0 : 1;
  limiter.threshold.value = -1;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.08;
  source.connect(gain).connect(limiter).connect(gate);
  return { gain, gate, output: gate, nodes: [gain, limiter, gate] };
}
// Gain follows denoising/effects, before publication and private monitoring.
// Only the owned output is stopped; this processor never plays to speakers.
export class MicrophoneInput
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  readonly name = "CineGather microphone input";
  processedTrack?: MediaStreamTrack;
  private context?: AudioContext;
  private gain?: GainNode;
  private gate?: GainNode;
  private destination?: MediaStreamAudioDestinationNode;
  private nodes: AudioNode[] = [];
  private generation = 0;
  private muted: boolean;
  constructor(
    private readonly inner: Inner | undefined,
    private readonly isMuted = () => false,
    private volume = 100,
  ) {
    this.muted = isMuted();
    this.volume = microphoneInputVolume(volume);
  }
  setInputVolume(value: number) {
    this.volume = microphoneInputVolume(value);
    if (this.gain && this.context)
      this.gain.gain.setTargetAtTime(
        this.volume / 100,
        this.context.currentTime,
        0.02,
      );
  }
  setMuted(value: boolean) {
    this.muted = value;
    this.inner?.setMuted?.(value);
    if (this.gate && this.context)
      this.gate.gain.setValueAtTime(value ? 0 : 1, this.context.currentTime);
  }
  setStrength(value: number) {
    this.inner?.setStrength?.(value);
  }
  async init(options: AudioProcessorOptions) {
    const generation = ++this.generation;
    this.release();
    try {
      await this.inner?.init(options);
      if (generation !== this.generation) return;
      this.context = options.audioContext;
      this.muted = this.isMuted();
      const source = this.context.createMediaStreamSource(
        new MediaStream([this.inner?.processedTrack ?? options.track]),
      );
      this.nodes = [source];
      const graph = createMicrophoneInputGraph(
        this.context,
        source,
        this.volume,
        this.muted,
      );
      this.nodes.push(...graph.nodes);
      this.gain = graph.gain;
      this.gate = graph.gate;
      const destination = this.context.createMediaStreamDestination();
      this.destination = destination;
      destination.channelCount = 1;
      this.nodes.push(destination);
      graph.output.connect(destination);
      this.processedTrack = destination.stream.getAudioTracks()[0];
    } catch (error) {
      if (generation === this.generation) {
        this.release();
        await this.inner?.destroy();
      }
      throw error;
    }
  }
  async restart(options: AudioProcessorOptions) {
    await this.init(options);
  }
  private release() {
    for (const node of this.nodes) node.disconnect();
    this.nodes = [];
    this.destination?.stream.getTracks().forEach((t) => t.stop());
    this.destination = undefined;
    this.processedTrack = undefined;
    this.context = undefined;
    this.gain = undefined;
    this.gate = undefined;
  }
  async destroy() {
    ++this.generation;
    this.release();
    await this.inner?.destroy();
  }
}
