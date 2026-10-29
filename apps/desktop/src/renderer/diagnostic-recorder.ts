import { diagnosticHash, type MediaSession } from "@cinegather/media-core";
import {
  diagnosticRetentionMs,
  safeDiagnosticRecord,
  diagnosticServerSchema,
  diagnosticSnapshotSchema,
  repairDiagnosticRecord,
  type DiagnosticIssue,
  type MediaDiagnostic,
  type DiagnosticRecord,
  type DiagnosticHistoryStatus,
} from "@cinegather/contracts";
import type { DesktopSettings } from "@cinegather/contracts";
import { diagnosticArchive } from "../shared/diagnostics";
import { version } from "../../package.json";

// Web uses IndexedDB so background/reload history does not disappear. Desktop uses
// the main process journal so a renderer crash cannot discard the preceding hour.
class BrowserHistory {
  private database?: Promise<IDBDatabase>;
  private fallback: DiagnosticRecord[] = [];
  private failures = 0;
  private fallbackBytes = 0;
  private dropped = 0;
  private lastPrune = 0;
  private open() {
    return (this.database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("cinegather-diagnostics", 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("records")) {
          const store = request.result.createObjectStore("records", {
            keyPath: "key",
          });
          store.createIndex("at", "at");
        }
        if (!request.result.objectStoreNames.contains("meta"))
          request.result.createObjectStore("meta");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.database = undefined;
        reject(request.error);
      };
      request.onblocked = () => {
        this.database = undefined;
        reject(new Error("diagnostic-storage-blocked"));
      };
    }));
  }
  async append(entry: DiagnosticRecord) {
    try {
      const database = await this.open();
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(["records", "meta"], "readwrite"),
          store = tx.objectStore("records"),
          meta = tx.objectStore("meta");
        const size = JSON.stringify(entry).length * 2;
        store.put({
          key: `${entry.session}:${entry.sequence}`,
          at: entry.at,
          entry,
          size,
        });
        const totals = meta.get("bytes");
        totals.onsuccess = () => {
          let bytes = Number(totals.result ?? 0) + size;
          const prune =
            Date.now() - this.lastPrune > 60_000 || bytes > 192 * 1024 * 1024;
          if (!prune) {
            meta.put(bytes, "bytes");
            return;
          }
          this.lastPrune = Date.now();
          const cursor = store.index("at").openCursor();
          cursor.onsuccess = () => {
            const item = cursor.result;
            if (
              item &&
              (item.value.at < Date.now() - diagnosticRetentionMs ||
                bytes > 192 * 1024 * 1024)
            ) {
              if (bytes > 192 * 1024 * 1024) this.dropped++;
              bytes = Math.max(0, bytes - Number(item.value.size ?? 0));
              item.delete();
              item.continue();
            } else meta.put(bytes, "bytes");
          };
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch {
      this.failures++;
      const fallback: DiagnosticRecord = {
        ...entry,
        issues: [
          ...(entry.issues ?? []).slice(0, 63),
          { stage: "storage", code: "storage-failed" },
        ],
      };
      this.fallback.push(fallback);
      this.fallbackBytes += JSON.stringify(fallback).length * 2;
      // Explicitly report degraded retention if storage is unavailable.
      while (
        this.fallback.length > 7200 ||
        this.fallbackBytes > 64 * 1024 * 1024 ||
        (this.fallback[0]?.at ?? Date.now()) <
          Date.now() - diagnosticRetentionMs
      ) {
        const old = this.fallback.shift();
        if (old) this.fallbackBytes -= JSON.stringify(old).length * 2;
        this.dropped++;
      }
    }
  }
  async read() {
    let entries: DiagnosticRecord[] = [];
    try {
      const database = await this.open();
      entries = await new Promise((resolve, reject) => {
        const request = database
          .transaction("records")
          .objectStore("records")
          .index("at")
          .getAll(IDBKeyRange.lowerBound(Date.now() - diagnosticRetentionMs));
        request.onsuccess = () =>
          resolve(request.result.map((value) => value.entry));
        request.onerror = () => reject(request.error);
      });
    } catch {
      /* The in-memory fallback still exports a declared partial history. */
    }
    return [...entries, ...this.fallback]
      .filter((x) => x.at >= Date.now() - diagnosticRetentionMs)
      .sort((a, b) => a.at - b.at);
  }
  async status(): Promise<DiagnosticHistoryStatus> {
    try {
      const database = await this.open();
      return await new Promise((resolve, reject) => {
        const tx = database.transaction(["records", "meta"]),
          index = tx.objectStore("records").index("at"),
          range = IDBKeyRange.lowerBound(Date.now() - diagnosticRetentionMs);
        const count = index.count(range),
          first = index.openCursor(range),
          last = index.openCursor(range, "prev"),
          bytes = tx.objectStore("meta").get("bytes");
        tx.oncomplete = () =>
          resolve({
            since: first.result?.value.at,
            until: last.result?.value.at,
            records: count.result,
            bytes: Number(bytes.result ?? 0),
            writeFailures: this.failures,
            dropped: this.dropped,
            retentionMs: diagnosticRetentionMs,
          });
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch {
      return {
        since: this.fallback[0]?.at,
        until: this.fallback.at(-1)?.at,
        records: this.fallback.length,
        bytes: 0,
        writeFailures: this.failures,
        dropped: this.dropped,
        retentionMs: diagnosticRetentionMs,
      };
    }
  }
}
type Context = {
  room?: { id: string };
  roomState: string;
  shareState: string;
  settings: DesktopSettings;
  media: { watching: boolean; revision?: number; videoPaused?: boolean };
  user?: unknown;
};
export class DiagnosticRecorder {
  private session = crypto.randomUUID();
  private sequence = 0;
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private generation = 0;
  private lastWallTick = Date.now();
  private lastTick = performance.now();
  private lastSample = 0;
  private lastServer = 0;
  private roomHash?: { id: string; hash: string };
  private longTasks = 0;
  private longTaskMs = 0;
  private observer?: PerformanceObserver;
  private web = new BrowserHistory();
  private previousContext = "";
  private collectionFailures = 0;
  private pendingIssues: DiagnosticIssue[] = [];
  private issue(value: DiagnosticIssue) {
    if (this.pendingIssues.length < 64) this.pendingIssues.push(value);
  }
  private pendingEvents: {
    name: string;
    durationMs?: number;
    count?: number;
  }[] = [];
  constructor(
    private media: MediaSession,
    private context: () => Context,
    private server: () => Promise<unknown>,
  ) {}
  private async record(
    value: Partial<DiagnosticRecord> & Pick<DiagnosticRecord, "kind">,
  ) {
    const pending = this.pendingIssues.splice(0);
    let stage: DiagnosticIssue["stage"] = "record";
    let timedOut = false;
    try {
      const context = this.context();
      if (context.room?.id !== this.roomHash?.id)
        this.roomHash = context.room
          ? { id: context.room.id, hash: await diagnosticHash(context.room.id) }
          : undefined;
      const candidate = repairDiagnosticRecord({
        v: 1,
        appVersion: version,
        at: Date.now(),
        monotonicMs: performance.now(),
        session: this.session,
        sequence: this.sequence++,
        room: this.roomHash?.hash,
        context: {
          connection: context.roomState,
          share: context.shareState,
          quality: context.settings.quality,
          watchProfile: context.settings.watchProfile,
          noiseReduction: context.settings.noiseReduction,
          microphoneEffect: context.settings.microphoneEffect ?? "none",
          pushToTalk: context.settings.pushToTalk,
          watching: context.media.watching,
          videoPaused: context.media.videoPaused,
          hidden: document.hidden,
          online: navigator.onLine,
        },
        ...value,
        issues: [...pending, ...(value.issues ?? [])].slice(0, 64),
      });
      const entry = safeDiagnosticRecord(candidate);
      stage = "storage";
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          window.desktop?.diagnostics
            ? window.desktop.diagnostics.record(entry)
            : this.web.append(entry),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              timedOut = true;
              reject(new Error("storage-timeout"));
            }, 1500);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      return true;
    } catch {
      for (const value of pending) this.issue(value);
      this.issue({
        stage,
        code: timedOut
          ? "timeout"
          : stage === "storage"
            ? "storage-failed"
            : "invalid-field",
      });
      this.collectionFailures++; /* Telemetry must never interrupt playback. */
      return false;
    }
  }
  start() {
    this.stop();
    const generation = ++this.generation;
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const task of list.getEntries()) {
          this.longTasks++;
          this.longTaskMs += task.duration;
        }
      });
      this.observer.observe({ type: "longtask", buffered: false });
    } catch {
      /* Unsupported in some browser versions. */
    }
    for (const name of ["online", "offline", "visibilitychange"])
      (name === "visibilitychange" ? document : window).addEventListener(
        name,
        this.lifecycle,
      );
    void this.record({ kind: "event", event: { name: "renderer-start" } });
    this.lastTick = performance.now();
    this.lastWallTick = Date.now();
    void this.tick(true);
    this.timer = setInterval(() => void this.tick(), 2000);
    return () => {
      if (generation === this.generation) this.stop();
    };
  }
  private lifecycle = (event: Event) => {
    if (this.pendingEvents.length < 32)
      this.pendingEvents.push({ name: event.type });
  };
  stop() {
    ++this.generation;
    clearInterval(this.timer);
    this.observer?.disconnect();
    for (const name of ["online", "offline", "visibilitychange"])
      (name === "visibilitychange" ? document : window).removeEventListener(
        name,
        this.lifecycle,
      );
  }
  async tick(force = false) {
    if (this.busy) return;
    this.busy = true;
    const now = performance.now(),
      lag = Math.max(0, now - this.lastTick - 2000);
    const wallElapsed = Date.now() - this.lastWallTick,
      monoElapsed = now - this.lastTick;
    this.lastWallTick = Date.now();
    this.lastTick = now;
    try {
      if (Math.abs(wallElapsed - monoElapsed) > 2000)
        await this.record({
          kind: "gap",
          event: {
            name: "system-clock-changed",
            durationMs: wallElapsed - monoElapsed,
          },
        });
      if (lag > 5500)
        await this.record({
          kind: "gap",
          event: { name: "sampling-gap", durationMs: lag },
        });
      if (this.collectionFailures) {
        const count = this.collectionFailures;
        this.collectionFailures = 0;
        await this.record({
          kind: "gap",
          event: { name: "records-unavailable", count },
        });
      }
      const context = this.context();
      const stamp = JSON.stringify([
        context.room?.id,
        context.roomState,
        context.shareState,
        context.media.watching,
        context.media.videoPaused,
        context.settings.quality,
        context.settings.watchProfile,
      ]);
      if (stamp !== this.previousContext) {
        this.previousContext = stamp;
        await this.record({
          kind: "event",
          event: { name: "context-changed" },
        });
      }
      for (const event of [
        ...this.pendingEvents.splice(0),
        ...this.media.takeDiagnosticEvents(),
      ].slice(0, 64))
        await this.record({ kind: "event", event });
      if (force || context.room || now - this.lastSample > 15000) {
        this.lastSample = now;
        let media: MediaDiagnostic | undefined;
        let deadline: ReturnType<typeof setTimeout> | undefined;
        let timedOut = false;
        try {
          media = await Promise.race([
            this.media.detailedDiagnostics(),
            new Promise<never>((_, reject) => {
              deadline = setTimeout(() => {
                timedOut = true;
                reject(new Error("sampling-timeout"));
              }, 2500);
            }),
          ]);
        } catch {
          this.issue({
            stage: "media",
            code: timedOut ? "timeout" : "sample-failed",
          });
        } finally {
          clearTimeout(deadline);
        }
        if (
          this.context().room?.id !== context.room?.id ||
          this.context().media.revision !== context.media.revision
        ) {
          await this.record({
            kind: "gap",
            event: { name: "sample-room-changed" },
          });
          return;
        }
        const memory = (
          performance as Performance & {
            memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
          }
        ).memory;
        await this.record({
          kind: "sample",
          media,
          renderer: {
            schedulerLagMs: lag,
            longTaskCount: this.longTasks,
            longTaskMs: this.longTaskMs,
            heapUsed: memory?.usedJSHeapSize,
            heapLimit: memory?.jsHeapSizeLimit,
          },
        });
        this.longTasks = 0;
        this.longTaskMs = 0;
      }
      if (context.user && context.room && now - this.lastServer >= 15000) {
        this.lastServer = now;
        void this.serverSample();
      }
    } catch {
      this.issue({ stage: "media", code: "sample-failed" });
      this.collectionFailures++;
    } finally {
      this.busy = false;
    }
  }
  private async serverSample() {
    const start = Date.now(),
      mono = performance.now(),
      room = this.context().room?.id;
    try {
      const result = diagnosticServerSchema.parse(await this.server()),
        duration = performance.now() - mono;
      if (this.context().room?.id !== room) return;
      await this.record({
        kind: "server",
        server: result,
        request: {
          status: "ok",
          durationMs: duration,
          clockOffsetMs:
            result.capturedAt === undefined
              ? undefined
              : result.capturedAt - (start + duration / 2),
          clockUncertaintyMs:
            result.capturedAt === undefined ? undefined : duration / 2,
        },
      });
    } catch {
      if (this.context().room?.id !== room) return;
      await this.record({
        kind: "server",
        request: { status: "failed", durationMs: performance.now() - mono },
      });
    }
  }
  async mark() {
    if (
      !(await this.record({
        kind: "marker",
        event: { name: "user-reported-stutter" },
      }))
    )
      throw new Error("未能保存卡顿标记，请尝试导出已有诊断");
  }
  async status() {
    return window.desktop?.diagnostics
      ? window.desktop.diagnostics.status()
      : this.web.status();
  }
  async export(current: Record<string, unknown>) {
    await this.tick(true);
    current = diagnosticSnapshotSchema.parse(current);
    if (window.desktop) return window.desktop.exportDiagnostics(current);
    const archive = await diagnosticArchive(
      await this.web.read(),
      {
        appVersion: version,
        platform: "web",
        userAgent: navigator.userAgent,
        history: await this.web.status(),
        storage: "indexeddb-or-declared-memory-fallback",
      },
      current,
    );
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(archive)], { type: "application/zip" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `cinegather-diagnostics-${Date.now()}.zip`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return true;
  }
}
