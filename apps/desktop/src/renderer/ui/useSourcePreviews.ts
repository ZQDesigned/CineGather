import { useEffect, useState } from "react";
import type { CaptureSource } from "@cinegather/contracts";

// Frames belong to this mounted picker only. Ignore late results after a tab
// change, refresh or close, and keep each native response below the pipe limit.
export function useSourcePreviews(sources: CaptureSource[], kind: string) {
  const [images, setImages] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  const enabled = Boolean(
    window.desktop?.nativeCapture && window.desktop.sourceThumbnails,
  );
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    const load = async () => {
      const ids = sources
        .filter((s) => s.kind === kind && !s.thumbnail)
        .map((s) => s.id);
      for (let i = 0; i < ids.length && current; i += 4) {
        const batch = ids.slice(i, i + 4);
        try {
          const frames = await window.desktop!.sourceThumbnails!(batch);
          if (!current) return;
          setImages((previous) => ({
            ...previous,
            ...Object.fromEntries(
              batch.map((id) => [
                id,
                frames.find((frame) => frame.id === id)?.thumbnail ?? "",
              ]),
            ),
          }));
        } catch {
          if (!current) return;
          setImages((previous) => ({
            ...previous,
            ...Object.fromEntries(batch.map((id) => [id, ""])),
          }));
        }
      }
    };
    queueMicrotask(() => {
      if (current) void load();
    });
    return () => {
      current = false;
    };
  }, [sources, kind, revision, enabled]);
  return {
    images,
    enabled,
    refresh: () => {
      setImages({});
      setRevision((previous) => previous + 1);
    },
  };
}
