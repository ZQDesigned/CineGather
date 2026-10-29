import type {
  AudioProcessorOptions,
  Track,
  TrackProcessor,
} from "livekit-client";
import { singingOptions, type SingingOptions } from "./karaoke";
// Music processing never uses a speech gate/AGC. Local monitoring is explicitly
// opt-in, starts at zero and is separate from the outgoing compensation delay.
export class SingingProcessor
  implements TrackProcessor<Track.Kind.Audio, AudioProcessorOptions>
{
  readonly name = "CineGather singing preview";
  processedTrack?: MediaStreamTrack;
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private destination?: MediaStreamAudioDestinationNode;
  private gain?: GainNode;
  private wet?: GainNode;
  private monitor?: GainNode;
  private delay?: DelayNode;
  private nodes: AudioNode[] = [];
  private generation = 0;
  private options = singingOptions();
  private outputDevice = "";
  configure(value: Partial<SingingOptions>) {
    this.options = singingOptions({ ...this.options, ...value });
    const at = this.context?.currentTime ?? 0;
    this.gain?.gain.setTargetAtTime(this.options.gain, at, 0.01);
    this.wet?.gain.setTargetAtTime(this.options.reverb, at, 0.02);
    this.monitor?.gain.setTargetAtTime(this.options.monitor, at, 0.02);
    this.delay?.delayTime.setTargetAtTime(
      this.options.delayMs / 1000,
      at,
      0.02,
    );
  }
  get metrics() {
    const c = this.context;
    return {
      processingContextBaseMs: c ? c.baseLatency * 1000 : undefined,
      monitorOutputLatencyMs:
        c && Number.isFinite(c.outputLatency)
          ? c.outputLatency * 1000
          : undefined,
      processorContextState: c?.state,
      processorActive: Boolean(
        this.processedTrack?.readyState === "live" && c?.state === "running",
      ),
      ...this.options,
    };
  }
  async device(id: string, requireMonitorOutput = false) {
    this.outputDevice = id;
    const c = this.context;
    if (c && "setSinkId" in c)
      await (
        c as AudioContext & { setSinkId(id: string): Promise<void> }
      ).setSinkId(id);
    else if (id && (requireMonitorOutput || this.options.monitor > 0))
      throw new Error(
        "当前设备不支持所选耳返输出，请关闭耳返或使用系统默认输出",
      );
  }
  async init({ track, audioContext }: AudioProcessorOptions) {
    const generation = ++this.generation;
    await this.release();
    if (generation !== this.generation) return;
    const c = audioContext;
    this.context = c;
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          c.resume(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("演唱音频尚未启动，请重试")),
              3000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (generation !== this.generation) return;
      await this.device(this.outputDevice);
      if (generation !== this.generation) return;
      const source = (this.source = c.createMediaStreamSource(
        new MediaStream([track]),
      ));
      const gain = (this.gain = c.createGain()),
        mix = c.createGain(),
        wet = (this.wet = c.createGain()),
        delay = (this.delay = c.createDelay(0.25)),
        compressor = c.createDynamicsCompressor(),
        monitor = (this.monitor = c.createGain());
      const destination = (this.destination = c.createMediaStreamDestination());
      destination.channelCount = 1;
      monitor.gain.value = 0;
      compressor.threshold.value = -3;
      compressor.knee.value = 3;
      compressor.ratio.value = 20;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.12;
      source.connect(gain);
      gain.connect(mix);
      // Sparse quiet early reflections; no feedback loop or unbounded tail.
      for (const [seconds, level] of [
        [0.023, 0.5],
        [0.037, 0.3],
        [0.061, 0.2],
      ]) {
        const echo = c.createDelay(0.1),
          levelNode = c.createGain();
        echo.delayTime.value = seconds!;
        levelNode.gain.value = level!;
        gain.connect(echo).connect(levelNode).connect(wet);
        this.nodes.push(echo, levelNode);
      }
      wet.connect(mix);
      mix.connect(delay).connect(compressor).connect(destination);
      mix.connect(monitor).connect(c.destination);
      this.nodes.push(gain, mix, wet, delay, compressor, monitor);
      this.processedTrack = destination.stream.getAudioTracks()[0];
      this.configure(this.options);
    } catch (error) {
      if (generation === this.generation) await this.release();
      throw error;
    }
  }
  async restart(options: AudioProcessorOptions) {
    await this.init(options);
  }
  private async release() {
    this.source?.disconnect();
    this.source = undefined;
    for (const node of this.nodes) node.disconnect();
    this.nodes = [];
    this.destination?.stream.getTracks().forEach((t) => t.stop());
    this.destination = undefined;
    this.processedTrack = undefined;
    this.gain = undefined;
    this.wet = undefined;
    this.monitor = undefined;
    this.delay = undefined;
    // The SDK owns this context; stopping a singer must not close room audio.
    this.context = undefined;
  }
  async destroy() {
    ++this.generation;
    await this.release();
  }
}
