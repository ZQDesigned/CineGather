// Stereo PCM at 48 kHz. Keep at most 100 ms, with a 20 ms initial jitter buffer.
export class PcmQueue {
  private readonly samples = new Int16Array(4800 * 2);
  private read = 0;
  private write = 0;
  private playing = false;
  push(input: Int16Array) {
    if (!input.length || input.length % 2) return;
    for (const sample of input)
      this.samples[this.write++ % this.samples.length] = sample;
    if (this.write - this.read > this.samples.length)
      this.read = this.write - this.samples.length;
  }
  render(left: Float32Array, right: Float32Array) {
    left.fill(0);
    right.fill(0);
    const available = this.write - this.read;
    if (!this.playing && available < 960 * 2) return;
    this.playing = true;
    const frames = Math.min(left.length, right.length, available / 2);
    for (let i = 0; i < frames; ++i) {
      left[i] = this.samples[this.read++ % this.samples.length]! / 32768;
      right[i] = this.samples[this.read++ % this.samples.length]! / 32768;
    }
    if (frames < left.length) this.playing = false;
  }
}
