import { Alert, Button, Select } from "antd";
import { watchProfiles, type WatchProfile } from "@cinegather/contracts";
import { useApp } from "../store";
import { setWatchProfile, report } from "../controller";
export function WatchProfileControl() {
  const profile = useApp((state) => state.settings.watchProfile ?? "balanced");
  const supported = useApp((state) => state.media.watchBuffering);
  return (
    <Select<WatchProfile>
      aria-label="观看档位"
      size="small"
      value={profile}
      style={{ width: 100 }}
      disabled={supported === false}
      getPopupContainer={(trigger) => trigger.ownerDocument.body}
      onChange={(next: WatchProfile) =>
        void setWatchProfile(next).catch(report)
      }
      options={
        supported === false
          ? [{ value: profile, label: "自动缓冲" }]
          : Object.entries(watchProfiles).map(([value, item]) => ({
              value,
              label: item.label,
            }))
      }
    />
  );
}
export function WatchAdvice() {
  const media = useApp((state) => state.media);
  if (
    !media.watching ||
    media.sharer?.local ||
    media.videoPaused ||
    !media.watchAdvice
  )
    return null;
  return (
    <Alert
      key={media.watchAdvice + media.sharer?.id}
      type="warning"
      showIcon
      closable
      title={
        media.watchAdvice === "network"
          ? "画面持续卡顿，可尝试流畅档位"
          : "网络仍不稳定，可请共享者降低共享画质"
      }
      action={
        media.watchAdvice === "network" &&
        media.watchBuffering !== false && (
          <Button
            size="small"
            onClick={() => void setWatchProfile("smooth").catch(report)}
          >
            切换至流畅
          </Button>
        )
      }
    />
  );
}
