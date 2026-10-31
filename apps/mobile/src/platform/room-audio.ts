import { requireOptionalNativeModule, NativeModule } from "expo-modules-core";
type Events = {
  leave(): void;
  timer(event: { id: number }): void;
  tick(): void;
  interruption(event: { interrupted: boolean }): void;
  routeLost(): void;
};
declare class RoomAudio extends NativeModule<Events> {
  scheduleTimer(id: number, delay: number, repeat: boolean): void;
  cancelTimer(id: number): void;
  requestMicrophonePermission(): Promise<boolean>;
  start(name: string, microphone: boolean): Promise<void>;
  stop(): Promise<void>;
}
const native = requireOptionalNativeModule<RoomAudio>("CineGatherRoomAudio");
export const roomAudio = {
  async requestMicrophonePermission() {
    if (!native) return false;
    return native.requestMicrophonePermission();
  },
  scheduleTimer(id: number, delay: number, repeat: boolean) {
    if (!native?.scheduleTimer)
      throw new Error("请重新构建支持后台心跳的开发客户端");
    native.scheduleTimer(id, delay, repeat);
  },
  cancelTimer(id: number) {
    native?.cancelTimer(id);
  },
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
