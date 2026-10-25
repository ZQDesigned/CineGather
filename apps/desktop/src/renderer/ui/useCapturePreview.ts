import { useEffect, useState } from "react";
import type { CapturePreview } from "@cinegather/contracts";

export function useCapturePreview(session?: string) {
  const [view, setView] = useState<{
    session?: string;
    frame?: CapturePreview;
    unavailable?: boolean;
  }>({});
  useEffect(() => {
    const read = window.desktop?.capturePreview;
    if (!session || !read) return;
    let current = true;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (!current || pending || document.hidden) return;
      pending = true;
      try {
        const frame = await read();
        if (current)
          setView({ session, frame: frame ?? undefined, unavailable: !frame });
      } catch {
        if (current) setView({ session, unavailable: true });
      } finally {
        pending = false;
        if (current && !document.hidden)
          timer = setTimeout(() => void poll(), 200);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", visibility);
    void poll();
    return () => {
      current = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [session]);
  return view.session === session ? view : {};
}
