import { requireOptionalNativeModule, NativeModule } from "expo-modules-core";
type Events = {
  leave(): void;
  interruption(event: { interrupted: boolean }): void;
  routeLost(): void;
};
declare class RoomAudio extends NativeModule<Events> {
  start(name: string, microphone: boolean): Promise<void>;
  stop(): Promise<void>;
}
const native = requireOptionalNativeModule<RoomAudio>("CineGatherRoomAudio");
export const roomAudio = {
  async start(name: string, microphone: boolean) {
    if (!native)
      throw new Error("当前测试包缺少后台音频模块，请重新构建客户端");
    await native.start(name, microphone);
  },
  async stop() {
    await native?.stop();
  },
  addListener<E extends keyof Events>(event: E, listener: Events[E]) {
    return native?.addListener(event, listener);
  },
};
