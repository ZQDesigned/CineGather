/* global AudioWorkletProcessor, registerProcessor */
class AudioRecordingWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.remaining = options.processorOptions.frames;
    this.offset = 0;
    this.channels = Array.from({ length: 3 }, () => new Float32Array(2048));
  }
  process(inputs, outputs) {
    outputs[0]?.[0]?.fill(0);
    const input = inputs[0];
    if (!input?.[0]) return true;
    const count = Math.min(input[0].length, this.remaining);
    for (let sample = 0; sample < count; sample++) {
      for (let channel = 0; channel < 3; channel++)
        this.channels[channel][this.offset] = input[channel]?.[sample] ?? 0;
      this.offset++;
      this.remaining--;
      if (this.offset === 2048 || this.remaining === 0) {
        const channels = this.channels.map((data) =>
          data.slice(0, this.offset),
        );
        this.port.postMessage(
          { type: "samples", channels },
          channels.map((data) => data.buffer),
        );
        this.offset = 0;
      }
    }
    if (this.remaining > 0) return true;
    this.port.postMessage({ type: "done" });
    return false;
  }
}
registerProcessor("test-audio-recording", AudioRecordingWorklet);
