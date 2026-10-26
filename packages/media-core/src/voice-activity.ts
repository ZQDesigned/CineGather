// SFU speaker events aggregate every audio track belonging to a participant.
// When they play accompaniment, measure only their real microphone instead.
export class VoiceActivity {
  private context?: AudioContext;
  private routes = new Map<string, { active(): boolean; release(): void }>();
  constructor(private readonly createContext = () => new AudioContext()) {}
  bind(id: string, stream: MediaStream) {
    this.remove(id);
    let source: MediaStreamAudioSourceNode | undefined,
      analyser: AnalyserNode | undefined,
      silence: GainNode | undefined;
    try {
      const context = (this.context ??= this.createContext());
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      silence = context.createGain();
      analyser.fftSize = 512;
      silence.gain.value = 0;
      source.connect(analyser);
      analyser.connect(silence);
      silence.connect(context.destination);
      const samples = new Float32Array(512),
        probe = analyser,
        input = source,
        output = silence;
      this.routes.set(id, {
        active: () => {
          if (context.state !== "running") return false;
          probe.getFloatTimeDomainData(samples);
          return (
            samples.reduce((sum, value) => sum + value * value, 0) /
              samples.length >
            0.000025
          );
        },
        release: () => {
          input.disconnect();
          probe.disconnect();
          output.disconnect();
        },
      });
      void context.resume().catch(() => {});
    } catch {
      source?.disconnect();
      analyser?.disconnect();
      silence?.disconnect();
    }
  }
  active(id: string) {
    return this.routes.get(id)?.active();
  }
  remove(id: string) {
    this.routes.get(id)?.release();
    this.routes.delete(id);
  }
  clear() {
    for (const route of this.routes.values()) route.release();
    this.routes.clear();
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }
}
