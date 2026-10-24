import workletUrl from "./process-audio.worklet.ts?worker&url";
import type { DesktopBridge } from "@cinegather/contracts";

export class ProcessAudio {
  private generation = 0;
  private dispose?: () => Promise<void>;
  constructor(private readonly failed: (message: string) => void) {}
  async start(bridge: NonNullable<DesktopBridge["processAudio"]>) {
    const generation = ++this.generation;
    const previous = this.dispose;
    this.dispose = undefined;
    await previous?.();
    if (generation !== this.generation) throw new Error("共享已取消");
    const context = new AudioContext({
      sampleRate: 48000,
      latencyHint: "interactive",
    });
    let sessionId: string | undefined;
    let node: AudioWorkletNode | undefined;
    let destination: MediaStreamAudioDestinationNode | undefined;
    let unsubscribe = () => {},
      unsubscribeError = () => {};
    const cleanup = async () => {
      unsubscribe();
      unsubscribeError();
      if (node) {
        node.port.onmessage = null;
        node.port.close();
        node.onprocessorerror = null;
      }
      node?.disconnect();
      destination?.stream.getTracks().forEach((track) => track.stop());
      await Promise.allSettled([bridge.stop(), context.close()]);
    };
    this.dispose = cleanup;
    const current = () => {
      if (generation !== this.generation) throw new Error("共享已取消");
    };
    try {
      await context.audioWorklet.addModule(workletUrl);
      current();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          context.resume(),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("声音处理未启动，请重新开始共享")),
              3000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      current();
      destination = context.createMediaStreamDestination();
      node = new AudioWorkletNode(context, "cg-process-audio", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      node.connect(destination); // Never connect captured audio to speakers.
      node.onprocessorerror = () => {
        if (generation === this.generation)
          this.failed("共享声音处理中断，请重新开始共享");
      };
      node.port.onmessage = ({ data }: MessageEvent<number>) => {
        if (sessionId && generation === this.generation)
          bridge.acknowledge(sessionId, data);
      };
      unsubscribe = bridge.onData((packet) => {
        if (packet.sessionId !== sessionId || generation !== this.generation)
          return;
        const samples = Uint8Array.from(packet.data).buffer;
        node!.port.postMessage({ samples, sequence: packet.sequence }, [
          samples,
        ]);
      });
      unsubscribeError = bridge.onError((id, message) => {
        if (id === sessionId && generation === this.generation)
          this.failed(message);
      });
      sessionId = await bridge.start();
      current();
      return destination.stream.getAudioTracks()[0]!;
    } catch (error) {
      if (generation === this.generation) await this.stop();
      throw error;
    }
  }
  async stop() {
    ++this.generation;
    const cleanup = this.dispose;
    this.dispose = undefined;
    await cleanup?.();
  }
}
