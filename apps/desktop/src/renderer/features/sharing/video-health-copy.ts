import type { VideoHealthStatus } from "@cinegather/media-core";
export function videoHealthCopy(kind: VideoHealthStatus["kind"]) {
  const messages = {
    checking: ["正在确认画面状态", "开始观看后，会检查画面的接收和播放情况。"],
    smooth: ["画面正在正常更新", "最近的画面接收、处理和播放保持同步。"],
    "few-updates": [
      "画面更新较少",
      "共享内容可能比较静止。若正在播放视频仍不流畅，可请共享者降低画质或检查共享设备。",
    ],
    network: [
      "网络接收不稳定",
      "画面接收存在明显波动，可尝试流畅档位或切换网络。",
    ],
    decode: [
      "本机处理画面较慢",
      "画面已收到，但本机处理未能跟上。可关闭占用较大的应用，或请共享者降低画质。",
    ],
    render: [
      "本机播放画面跟不上",
      "已经处理好的画面未及时显示，可尝试重新加入观看。",
    ],
    unavailable: [
      "暂时无法确认画面状态",
      "当前设备未提供足够的播放信息。可导出诊断，进一步检查。",
    ],
    paused: ["画面检查已暂停", "画面接收已暂停，恢复观看后会继续检查。"],
  } as const;
  const [title, description] = messages[kind];
  return {
    title,
    description,
    warning: ["network", "decode", "render"].includes(kind),
  };
}
