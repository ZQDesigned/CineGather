import type { AccompanimentApplication } from "@cinegather/contracts";
import { commonAccompanimentApplications } from "../../shared/accompaniment-apps";

const executables: Record<AccompanimentApplication, readonly string[]> = {
  qqmusic: ["qqmusic.exe"],
  netease: ["cloudmusic.exe"],
  soda: ["sodamusic.exe"],
  kugou: ["kugou.exe"],
  douyin: ["douyin.exe"],
};
const bundles: Partial<Record<AccompanimentApplication, string>> = {
  qqmusic: "com.tencent.qqmusicmac",
  netease: "com.netease.163music",
  soda: "com.soda.music",
  douyin: "com.bytedance.douyin.desktop",
};
const aliases: Record<AccompanimentApplication, readonly string[]> = {
  qqmusic: ["qqmusic"],
  netease: ["neteasemusic", "neteasecloudmusic"],
  soda: ["sodamusic"],
  kugou: ["kugou", "kugoumusic"],
  douyin: ["douyin"],
};
export function identifyAccompanimentApplication(source: {
  name: string;
  executable?: string;
  target: string;
}): AccompanimentApplication | undefined {
  // Prefer OS process identity over mutable window titles, including browser tabs.
  if (source.executable)
    return commonAccompanimentApplications.find((app) =>
      executables[app.id].includes(source.executable!.toLowerCase()),
    )?.id;
  const bundle = commonAccompanimentApplications.find(
    (app) => bundles[app.id] === source.target.toLowerCase(),
  );
  if (bundle) return bundle.id;
  // macOS localized names and older helpers only get an exact-name fallback.
  const name = source.name.replace(/\s+/g, "").toLowerCase();
  return commonAccompanimentApplications.find(
    (app) =>
      name === app.name.replace(/\s+/g, "").toLowerCase() ||
      aliases[app.id].includes(name) ||
      executables[app.id].includes(name),
  )?.id;
}
