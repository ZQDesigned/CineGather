import type { AccompanimentApplication } from "@cinegather/contracts";

export const commonAccompanimentApplications = [
  { id: "qqmusic", name: "QQ 音乐" },
  { id: "netease", name: "网易云音乐" },
  { id: "soda", name: "汽水音乐" },
  { id: "kugou", name: "酷狗音乐" },
  { id: "douyin", name: "抖音" },
] as const satisfies readonly { id: AccompanimentApplication; name: string }[];
