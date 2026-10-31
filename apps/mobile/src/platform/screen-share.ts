import { requireOptionalNativeModule, NativeModule } from "expo-modules-core";
export interface CaptureOptions {
  id: string;
  url: string;
  token: string;
  audio: boolean;
  expiresAt: number;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}
export interface CaptureStatus {
  id: string;
  state: string;
  reason?: string;
}
declare class ScreenShare extends NativeModule<{
  status(event: CaptureStatus): void;
}> {
  start(options: CaptureOptions): Promise<void>;
  stop(id: string): Promise<void>;
  diagnostics(): Promise<Record<string, unknown>>;
  renew(id: string, expiresAt: number): Promise<void>;
}
const native = requireOptionalNativeModule<ScreenShare>(
  "CineGatherScreenShare",
);
export const screenShare = {
  available: !!native,
  async start(options: CaptureOptions) {
    if (!native)
      throw new Error("当前安装包尚未包含屏幕共享模块，请安装新版测试客户端");
    const url = new URL(options.url);
    if (
      url.username ||
      url.password ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
        ))
    )
      throw new Error("推流服务必须使用 HTTPS 或本机地址");
    await native.start(options);
  },
  async stop(id: string) {
    await native?.stop(id);
  },
  async renew(id: string, expiresAt: number) {
    await native?.renew(id, expiresAt);
  },
  async diagnostics() {
    return (await native?.diagnostics()) ?? {};
  },
  listen(listener: (event: CaptureStatus) => void) {
    return native?.addListener("status", listener);
  },
};
