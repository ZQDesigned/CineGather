const messages: Record<string, string> = {
  "graphics-adapter-mismatch":
    "实际使用的显卡与所选显卡不一致，请重新选择编码器或重启客户端",
  "obs-startup": "原生采集引擎无法启动，请重新安装客户端或导出连接诊断",
  "audio-reset": "无法初始化声音设备，请检查系统声音设置后重试",
  "encoder-unavailable": "所选编码器已不可用，请在设置中重新选择共享编码器",
  "encoder-create": "无法创建所选编码器，请检查显卡驱动或选择其他编码器",
  "encoder-initialization":
    "所选编码器启动失败，请检查显卡驱动、关闭其他录制程序或选择其他编码器",
  "encoder-adapter-reroute":
    "所选编码器无法使用指定显卡，请检查驱动或选择其他编码器",
  "all-encoders-failed": "所有共享编码器均启动失败，请导出连接诊断以排查原因",
  "graphics-initialization": "无法初始化所选显卡，请检查驱动或选择其他编码器",
  "audio-initialization": "无法采集共享声音，请检查声音设备后重试",
  "display-unavailable": "所选显示器已不可用，请重新选择共享来源",
  "window-unavailable": "所选窗口已不可用，请重新选择共享来源",
  "lease-expired": "共享授权已过期，请重新共享",
};
export function nativeFailure(error: unknown) {
  return error instanceof Error && messages[error.message]
    ? new Error(messages[error.message])
    : error;
}
