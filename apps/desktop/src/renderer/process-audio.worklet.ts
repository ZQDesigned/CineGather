import { PcmQueue } from "./process-audio-buffer";
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;

class ProcessAudioProcessor extends AudioWorkletProcessor {
  private readonly queue = new PcmQueue();
  constructor() {
    super();
    this.port.onmessage = ({
      data,
    }: MessageEvent<{ samples: ArrayBuffer; sequence: number }>) => {
      if (
        data.samples instanceof ArrayBuffer &&
        data.samples.byteLength <= 192000 &&
        data.samples.byteLength % 4 === 0
      )
        this.queue.push(new Int16Array(data.samples));
      this.port.postMessage(data.sequence);
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const channels = outputs[0];
    if (channels?.[0] && channels[1])
      this.queue.render(channels[0], channels[1]);
    return true;
  }
}
registerProcessor("cg-process-audio", ProcessAudioProcessor);
