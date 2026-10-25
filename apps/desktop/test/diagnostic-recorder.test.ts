import { expect, test } from "bun:test";
import { DiagnosticRecorder } from "../src/renderer/diagnostic-recorder";
import { type DiagnosticRecord } from "@cinegather/contracts";
import { defaultSettings } from "../src/shared/settings";
import type { MediaSession } from "@cinegather/media-core";

test("a media sampling exception preserves renderer evidence and recovers on the next tick", async () => {
  const originalWindow = globalThis.window,
    originalDocument = globalThis.document,
    originalNavigator = globalThis.navigator;
  const entries: DiagnosticRecord[] = [];
  let failMedia = true,
    failStorage = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      desktop: {
        diagnostics: {
          async record(entry: DiagnosticRecord) {
            if (failStorage) throw new Error("Bearer ipc-private");
            entries.push(entry);
          },
        },
      },
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { hidden: false },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  try {
    const media = {
      takeDiagnosticEvents: () => [],
      async detailedDiagnostics() {
        if (failMedia) throw new Error("https://private/?token=secret");
        return {
          state: "connected",
          watching: true,
          tracks: [],
          playback: { width: 1920, height: 1080, currentTime: NaN },
        };
      },
    };
    const recorder = new DiagnosticRecorder(
      media as unknown as MediaSession,
      () => ({
        roomState: "connected",
        shareState: "idle",
        media: { watching: true },
        settings: defaultSettings,
      }),
      async () => ({}),
    );
    await recorder.tick(true);
    const partial = entries.find((x) => x.kind === "sample")!;
    expect(partial.renderer).toBeDefined();
    expect(partial.issues).toContainEqual({
      stage: "media",
      code: "sample-failed",
    });
    failMedia = false;
    failStorage = true;
    await recorder.tick(true);
    failStorage = false;
    await recorder.tick(true);
    expect(
      entries.some((x) =>
        x.issues?.some(
          (i) => i.stage === "storage" && i.code === "storage-failed",
        ),
      ),
    ).toBe(true);
    expect(entries.at(-1)?.media?.playback).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(entries.at(-1)?.issues).toContainEqual({
      stage: "playback",
      code: "invalid-number",
      field: "media.playback.currentTime",
    });
    expect(JSON.stringify(entries)).not.toMatch(/private|secret|Bearer/);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  }
});
