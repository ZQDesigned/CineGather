import type {
  AudioProcessorOptions,
  Track,
  TrackProcessor,
} from "livekit-client";

// A fixed small-room preset: intelligible dry vocal plus a quiet decaying tail.
export function ktvImpulse(sampleRate: number) {
  const rate = Number.isFinite(sampleRate)
    ? Math.max(8000, Math.min(192000, Math.round(sampleRate)))
    : 48000;
  const impulse = new Float32Array(Math.round(rate * 1.2));
  let seed = 0x4b5456;
  for (let i = 0; i < impulse.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    impulse[i] =
      ((seed / 0x100000000) * 2 - 1) *
      Math.exp((-6.907755 * i) / impulse.length);
  }
  return impulse;
}
export function createKtvReverbGraph(
  context: BaseAudioContext,
  source: AudioNode,
  muted = false,
) {
  const dry = context.createGain(),
    wet = context.createGain(),
    mix = context.createGain(),
    output = context.createGain();
  const preDelay = context.createDelay(0.1),
    highpass = context.createBiquadFilter(),
    lowpass = context.createBiquadFilter(),
    reverb = context.createConvolver(),
    limiter = context.createDynamicsCompressor();
  dry.gain.value = 1;
  wet.gain.value = 0.28;
  output.gain.value = muted ? 0 : 1;
  preDelay.delayTime.value = 0.022;
  highpass.type = "highpass";
  highpass.frequency.value = 180;
  lowpass.type = "lowpass";
  lowpass.frequency.value = 6500;
  const impulse = context.createBuffer(
    1,
    Math.round(context.sampleRate * 1.2),
    context.sampleRate,
  );
  impulse.getChannelData(0).set(ktvImpulse(context.sampleRate));
  reverb.buffer = impulse;
  limiter.threshold.value = -3;
  limiter.knee.value = 6;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.005;
  limiter.release.value = 0.15;
  source.connect(dry).connect(mix);
  source
    .connect(preDelay)
    .connect(highpass)
    .connect(lowpass)
    .connect(reverb)
    .connect(wet)
    .connect(mix);
  mix.connect(limiter).connect(output);
  return {
    output,
    nodes: [
      dry,
      wet,
      mix,
      output,
      preDelay,
      highpass,
      lowpass,
      reverb,
      limiter,
    ],
  };
}
export class KtvReverb
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  readonly name = "CineGather KTV reverb";
  processedTrack?: MediaStreamTrack;
  private context?: AudioContext;
  private destination?: MediaStreamAudioDestinationNode;
  private gate?: GainNode;
  private nodes: AudioNode[] = [];
  private generation = 0;
  constructor(
    private readonly denoiser?: TrackProcessor<
      Track.Kind.Audio,
      AudioProcessorOptions
    >,
    private readonly isMuted = () => false,
  ) {}
  setMuted(muted: boolean) {
    if (this.gate && this.context)
      this.gate.gain.setValueAtTime(muted ? 0 : 1, this.context.currentTime);
  }
  async init(options: AudioProcessorOptions) {
    const revision = ++this.generation;
    this.releaseGraph();
    try {
      await this.denoiser?.init(options);
      if (revision !== this.generation) return;
      const context = options.audioContext;
      this.context = context;
      const input = this.denoiser?.processedTrack ?? options.track;
      const source = context.createMediaStreamSource(new MediaStream([input]));
      const destination = (this.destination =
        context.createMediaStreamDestination());
      destination.channelCount = 1;
      const graph = createKtvReverbGraph(context, source, this.isMuted());
      this.gate = graph.output;
      graph.output.connect(destination);
      this.nodes = [source, ...graph.nodes, destination];
      this.processedTrack = destination.stream.getAudioTracks()[0];
      // No node connects to context.destination: this effect is published only.
    } catch (error) {
      if (revision === this.generation) {
        this.releaseGraph();
        await this.denoiser?.destroy();
      }
      throw error;
    }
  }
  async restart(options: AudioProcessorOptions) {
    await this.init(options);
  }
  private releaseGraph() {
    for (const node of this.nodes) node.disconnect();
    this.nodes = [];
    this.destination?.stream.getTracks().forEach((t) => t.stop());
    this.destination = undefined;
    this.processedTrack = undefined;
    this.context = undefined;
    this.gate = undefined;
  }
  async destroy() {
    ++this.generation;
    this.releaseGraph();
    await this.denoiser?.destroy();
  }
}
