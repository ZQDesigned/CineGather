import { useEffect } from "react";
import { desktopUIIdentity, trackHotUpdates } from "../hot-runtime";
import { state } from "../../../store";
export function HotLifecycle() {
  useEffect(() => {
    const stop = trackHotUpdates(() => {
      const s = state();
      return Boolean(
        s.room ||
          !["idle", "failed"].includes(s.roomState) ||
          s.game.snapshot.self ||
          s.game.syncing ||
          s.game.local.state !== "idle" ||
          s.busy ||
          (s.modal && s.modal !== "updates") ||
          s.switchingSource ||
          s.accompaniment.status !== "idle" ||
          s.microphoneMonitor.state !== "off",
      );
    });
    const id = desktopUIIdentity();
    const frame = requestAnimationFrame(() => {
      if (id)
        void window.desktop?.hotUpdates
          ?.ready(id.bundleId)
          .catch(console.error);
    });
    return () => {
      cancelAnimationFrame(frame);
      stop();
    };
  }, []);
  return null;
}
