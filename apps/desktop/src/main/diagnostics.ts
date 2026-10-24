import { app, BrowserWindow, dialog, powerMonitor } from "electron";
import { cpus, freemem, totalmem, loadavg, release } from "node:os";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  safeDiagnosticRecord,
  diagnosticSnapshotSchema,
  type DiagnosticRecord,
} from "@cinegather/contracts";
import { DiagnosticHistory } from "./diagnostic-history";
import { diagnosticArchive } from "../shared/diagnostics";
import type { NativeCapture } from "./native-capture";
export class ProductionDiagnostics {
  private history: DiagnosticHistory;
  private session = randomUUID();
  private sequence = 0;
  private timer?: ReturnType<typeof setInterval>;
  private previousCpu = this.cpuTimes();
  private lastTick = performance.now();
  private gpu: unknown;
  private exportPending = false;
  private writeWindow = 0;
  private writeCount = 0;
  constructor(private native: () => NativeCapture | undefined) {
    this.history = new DiagnosticHistory(
      join(app.getPath("userData"), "diagnostics"),
    );
  }
  private cpuTimes() {
    const values = cpus();
    return {
      idle: values.reduce((n, c) => n + c.times.idle, 0),
      total: values.reduce(
        (n, c) => n + Object.values(c.times).reduce((a, b) => a + b, 0),
        0,
      ),
    };
  }
  private async own(
    value: Partial<DiagnosticRecord> & Pick<DiagnosticRecord, "kind">,
  ) {
    await this.history.append({
      v: 1,
      appVersion: app.getVersion(),
      at: Date.now(),
      monotonicMs: performance.now(),
      session: this.session,
      sequence: this.sequence++,
      ...value,
    });
  }
  start() {
    void app
      .getGPUInfo("basic")
      .then((value) => {
        const info = value as {
          gpuDevice?: {
            active?: boolean;
            deviceId?: number;
            vendorId?: number;
          }[];
          auxAttributes?: {
            softwareRendering?: boolean;
            directComposition?: boolean;
            supportsOverlays?: boolean;
          };
        };
        this.gpu = {
          devices: info.gpuDevice?.map((d) => ({
            active: d.active,
            deviceId: d.deviceId,
            vendorId: d.vendorId,
          })),
          softwareRendering: info.auxAttributes?.softwareRendering,
          directComposition: info.auxAttributes?.directComposition,
          supportsOverlays: info.auxAttributes?.supportsOverlays,
        };
      })
      .catch(() => {});
    void this.own({ kind: "event", event: { name: "main-start" } });
    powerMonitor.on(
      "suspend",
      () => void this.own({ kind: "event", event: { name: "suspend" } }),
    );
    powerMonitor.on(
      "resume",
      () => void this.own({ kind: "event", event: { name: "resume" } }),
    );
    powerMonitor.on(
      "lock-screen",
      () => void this.own({ kind: "event", event: { name: "lock-screen" } }),
    );
    powerMonitor.on(
      "unlock-screen",
      () => void this.own({ kind: "event", event: { name: "unlock-screen" } }),
    );
    app.on(
      "child-process-gone",
      (_event, details) =>
        void this.own({
          kind: "event",
          event: {
            name: `child-process-${details.type}-${details.reason}`,
            reason: details.exitCode,
          },
        }),
    );
    app.on("web-contents-created", (_event, contents) =>
      contents.on(
        "render-process-gone",
        (_event, details) =>
          void this.own({
            kind: "event",
            event: {
              name: `renderer-${details.reason}`,
              reason: details.exitCode,
            },
          }),
      ),
    );
    this.timer = setInterval(() => void this.sample(), 5000);
    this.timer.unref();
    app.on("will-quit", () => clearInterval(this.timer));
  }
  private async sample() {
    try {
      const now = performance.now(),
        lag = now - this.lastTick - 5000;
      this.lastTick = now;
      if (lag > 7500)
        await this.own({
          kind: "gap",
          event: { name: "main-sampling-gap", durationMs: lag },
        });
      const current = this.cpuTimes(),
        total = current.total - this.previousCpu.total,
        idle = current.idle - this.previousCpu.idle;
      this.previousCpu = current;
      await this.own({
        kind: "resources",
        native: this.native()?.diagnostics(),
        resources: {
          freeMemory: freemem(),
          totalMemory: totalmem(),
          cpuPercent: total > 0 ? (1 - idle / total) * 100 : undefined,
          load1: loadavg()[0] ?? 0,
          processes: app.getAppMetrics().map((p) => ({
            type: p.type,
            pid: p.pid,
            cpuPercent: p.cpu.percentCPUUsage,
            workingSetKb: p.memory.workingSetSize,
            peakWorkingSetKb: p.memory.peakWorkingSetSize,
          })),
        },
      });
    } catch {
      /* A metrics API failure must not interrupt a call or room session. */
    }
  }
  async record(input: unknown) {
    if (Date.now() - this.writeWindow > 60000) {
      this.writeWindow = Date.now();
      this.writeCount = 0;
    }
    if (++this.writeCount > 1000) throw new Error("诊断采样过于频繁");
    const entry = safeDiagnosticRecord(input);
    if (Math.abs(entry.at - Date.now()) > 60_000)
      throw new Error("诊断记录时间不正确");
    if (!(await this.history.append(entry)))
      throw new Error("诊断记录未能写入本地存储");
  }
  status() {
    return this.history.status();
  }
  async export(input: unknown, window: BrowserWindow) {
    if (this.exportPending) throw new Error("诊断正在导出，请稍等");
    const current = diagnosticSnapshotSchema.parse(input);
    this.exportPending = true;
    try {
      const target = await dialog.showSaveDialog(window, {
        defaultPath: `cinegather-diagnostics-${Date.now()}.zip`,
        filters: [{ name: "诊断压缩包", extensions: ["zip"] }],
      });
      if (target.canceled || !target.filePath) return false;
      await this.sample();
      const entries = await this.history.read(),
        status = await this.history.status();
      const archive = await diagnosticArchive(
        entries,
        {
          appVersion: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          osRelease: release(),
          cpuModel: cpus()[0]?.model,
          cpuCount: cpus().length,
          totalMemory: totalmem(),
          versions: {
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            node: process.versions.node,
          },
          gpu: { info: this.gpu, features: app.getGPUFeatureStatus() },
          history: status,
          storage: "local-minute-journal",
          capabilities: {
            rtcStats: true,
            nativeCapture: process.platform === "darwin",
            processMetrics: true,
            serverMetrics:
              "Requires matching API; SFU counters require LIVEKIT_METRICS_URL",
          },
        },
        current,
      );
      await writeFile(target.filePath, archive, { mode: 0o600 });
      return true;
    } finally {
      this.exportPending = false;
    }
  }
}
