import { useEffect, useRef, useState } from "react";
import { NativePreviewPlayer, type PreviewStatus } from "../native-preview";

export function useCapturePreview(session?: string) {
  const video = useRef<HTMLVideoElement>(null);
  const [view, setView] = useState<{ session?: string; status: PreviewStatus }>(
    { status: "paused" },
  );
  useEffect(() => {
    const bridge = window.desktop?.nativePreview;
    if (!session || !bridge || !video.current) return;
    let current = true,
      foreground = false,
      foregroundEvents = 0;
    const player = new NativePreviewPlayer(video.current, bridge, (status) => {
      if (current) setView({ session, status });
    });
    const sync = () =>
      player.setActive(foreground && !document.hidden && document.hasFocus());
    const focus = () =>
      queueMicrotask(() => {
        if (current) sync();
      });
    const remove = bridge.onForeground((active) => {
      ++foregroundEvents;
      foreground = active;
      sync();
    });
    void bridge
      .foreground()
      .then((active) => {
        if (current && !foregroundEvents) {
          foreground = active;
          sync();
        }
      })
      .catch(() => {
        if (current) setView({ session, status: "unavailable" });
      });
    window.addEventListener("focus", focus);
    window.addEventListener("blur", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      current = false;
      remove();
      player.dispose();
      window.removeEventListener("focus", focus);
      window.removeEventListener("blur", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [session]);
  return {
    video,
    status:
      view.session === session ? view.status : ("paused" as PreviewStatus),
  };
}
