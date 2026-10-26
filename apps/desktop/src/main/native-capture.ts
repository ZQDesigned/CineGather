import { version } from "../../package.json";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  leaseSchema,
  nativePublicationSchema,
  type CaptureSelection,
  type CaptureThumbnail,
  type NativePreviewOffer,
  type CaptureSource,
  type NativeCaptureRequest,
  type ShareLease,
  nativeDiagnosticSchema,
  nativeEncoderInventorySchema,
} from "@cinegather/contracts";
import { selectNativeSource } from "./native-selection";
import { NativeProtocol } from "./native-protocol";
import { nativeFailure } from "./native-failure";
const displaySchema = z.object({
  displayId: z.number().int(),
  name: z.string(),
});
const windowSchema = z.object({
  windowId: z.number().int(),
  pid: z.number().int(),
  title: z.string(),
  application: z.string(),
  bundleId: z.string(),
});
type NativeWindow = z.infer<typeof windowSchema>;
type Status = {
  audioCaptureError?: string;
  screenPermission: boolean;
  outputPhase: string;
  sourceWidth: number;
  sourcesActive: boolean;
  outputActive: boolean;
};
export class NativeCapture {
  private child?: ChildProcessWithoutNullStreams;
  private pipe?: NativeProtocol;
  private boot?: Promise<NativeProtocol>;
  private bootIssue?: string;
  private hostSession?: string;
  private rememberStatus(raw: unknown) {
    const status = nativeDiagnosticSchema.safeParse(raw);
    if (status.success)
      this.diagnosticStatus = {
        ...status.data,
        sampledAt: Date.now(),
        hostSession: this.hostSession,
      };
  }
  get startupFailure() {
    return this.bootIssue;
  }
  private selection?: ReturnType<typeof selectNativeSource>;
  private context?: NativeCaptureRequest;
  private epoch = 0;
  private selectionEpoch = 0;
  private poll?: ReturnType<typeof setInterval>;
  private polling = false;
  private started = false;
  private switching = false;
  private previewEpoch = 0;
  private previewId?: string;
  private previewAllowed() {
    return Boolean(
      this.context &&
        this.started &&
        this.pipe &&
        (this.options.previewAllowed?.() ?? true),
    );
  }
  async startPreview(id: string): Promise<NativePreviewOffer | null> {
    z.string().uuid().parse(id);
    if (!this.previewAllowed()) return null;
    const epoch = ++this.previewEpoch;
    this.previewId = id;
    try {
      const offer = z
        .object({
          sdp: z
            .string()
            .min(1)
            .max(65536)
            .refine((sdp) => {
              const lines = sdp.split(/\r?\n/);
              const candidates = lines.filter((line) =>
                line.startsWith("a=candidate:"),
              );
              return (
                lines[0] === "v=0" &&
                !lines.some((line) => line.startsWith("m=audio")) &&
                candidates.length > 0 &&
                candidates.every((line) => {
                  const fields = line.split(/\s+/);
                  return (
                    fields[2]?.toLowerCase() === "udp" &&
                    ["127.0.0.1", "::1"].includes(fields[4] ?? "") &&
                    fields[7] === "host"
                  );
                })
              );
            }),
        })
        .parse(await this.pipe!.call({ type: "preview-start" }));
      if (epoch !== this.previewEpoch) return null;
      if (!this.previewAllowed()) {
        await this.stopPreview(id);
        return null;
      }
      return { id, sdp: offer.sdp };
    } catch {
      if (epoch === this.previewEpoch) await this.stopPreview(id);
      return null;
    }
  }
  async answerPreview(id: string, sdp: string): Promise<boolean> {
    if (this.previewId !== id) return false;
    if (!this.previewAllowed()) {
      await this.stopPreview(id);
      return false;
    }
    const epoch = this.previewEpoch;
    try {
      await this.pipe!.call({
        type: "preview-answer",
        sdp: z.string().min(1).max(65536).parse(sdp),
      });
      return epoch === this.previewEpoch && this.previewAllowed();
    } catch {
      if (epoch === this.previewEpoch) await this.stopPreview(id);
      return false;
    }
  }
  async stopPreview(id?: string) {
    if (!this.previewId || (id && id !== this.previewId)) return;
    ++this.previewEpoch;
    this.previewId = undefined;
    await this.pipe?.call({ type: "preview-stop" }).catch(() => {});
  }
  private activeWindow?: NativeWindow;
  private activeDisplayId?: number;
  private checks = 0;
  private diagnosticStatus?: ReturnType<typeof nativeDiagnosticSchema.parse>;
  diagnostics() {
    return this.diagnosticStatus;
  }
  private previewSources = new Map<
    string,
    { id: string; windowId?: number; pid?: number; displayId?: number }
  >();
  private abort?: AbortController;
  constructor(
    private readonly bundle: string,
    private readonly directory: string,
    private readonly ended: (reason?: string) => void,
    private readonly ownApplication?: string,
    private readonly options: {
      platform?: NodeJS.Platform;
      previewAllowed?: () => boolean;
      encoder?: () => string;
      audioFallback?: () => void;
    } = {},
  ) {}
  private get windows() {
    return (this.options.platform ?? process.platform) === "win32";
  }
  get isSharing() {
    return Boolean(this.context);
  }
  async encoders() {
    return nativeEncoderInventorySchema.parse(
      await (await this.ensure()).call({ type: "encoders" }),
    );
  }
  async encoderDiagnostics() {
    if (!this.windows) return undefined;
    const pipe = await this.ensure();
    const inventory = await this.encoders();
    // A synthetic probe must never overwrite evidence from real publication.
    const lastSession = this.diagnosticStatus;
    const raw = await pipe.call({
      type: "probe",
      encoder: this.options.encoder?.() ?? "auto",
    });
    const probe = z
      .object({
        status: z.enum(["ok", "failed", "timeout", "skipped-sharing"]),
        reason: z
          .string()
          .max(80)
          .regex(/^[a-z-]+$/)
          .optional(),
        synthetic: z.boolean().optional(),
        width: z.number().finite().optional(),
        height: z.number().finite().optional(),
        targetFps: z.number().finite().optional(),
        framesEncoded: z.number().finite().optional(),
        bytesEncoded: z.number().finite().optional(),
        encoder: nativeDiagnosticSchema.optional(),
      })
      .parse(raw);
    return {
      inventory,
      lastSession,
      probe,
      queriedAt: Date.now(),
      policy: {
        backend: "libobs",
        manualFallback: false,
        automaticOrder: ["nvenc", "amf", "x264"],
      },
    };
  }
  private async ensure() {
    if (this.pipe) return this.pipe;
    if (this.boot) return this.boot;
    this.boot = (async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      this.hostSession = randomUUID();
      const child = spawn(
        join(
          this.bundle,
          this.windows
            ? "bin/64bit/CGScreenCaptureHost.exe"
            : "Contents/MacOS/CGScreenCaptureHost",
        ),
        this.windows
          ? [this.directory, String(process.pid), "stdio"]
          : [this.directory],
        { stdio: "pipe", windowsHide: true },
      );
      const pipe = new NativeProtocol(
        (data) => child.stdin.write(data),
        () => {
          this.bootIssue = "response-timeout";
          child.kill("SIGKILL");
        },
      );
      this.child = child;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data) => pipe.receive(data));
      child.stdin.on("error", () => pipe.close());
      child.stdout.on("error", () => pipe.close());
      // Discard third-party messages. Only our fixed, credential-free boot code may survive.
      this.bootIssue = undefined;
      let stderrBuffer = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderrBuffer += String(chunk);
        for (let newline; (newline = stderrBuffer.indexOf("\n")) >= 0; ) {
          const line = stderrBuffer.slice(0, newline).trim();
          stderrBuffer = stderrBuffer.slice(newline + 1);
          const match = /^CG_HOST_ERROR ([a-z-]{1,80})$/.exec(line);
          if (match) this.bootIssue = match[1];
          if (this.context && line.startsWith("CG_HOST_TRANSPORT ")) {
            try {
              const status = nativeDiagnosticSchema
                .pick({
                  transportPhase: true,
                  transportFailure: true,
                  transportHttpStatus: true,
                  transportErrorCode: true,
                })
                .strict()
                .safeParse(JSON.parse(line.slice(18)));
              if (status.success)
                this.diagnosticStatus = {
                  ...this.diagnosticStatus,
                  ...status.data,
                  hostEventAt: Date.now(),
                  hostSession: this.hostSession,
                };
            } catch {
              /* Ignore unknown third-party output. */
            }
          }
        }
        if (stderrBuffer.length > 512) stderrBuffer = "";
      });
      child.on("error", () =>
        pipe.close(new Error("原生采集引擎未安装，请重新构建应用")),
      );
      child.on("close", (code, signal) => {
        if (this.context) {
          this.diagnosticStatus = {
            ...this.diagnosticStatus,
            hostEventAt: Date.now(),
            hostSession: this.hostSession,
            ...(code === null ? {} : { hostExitCode: code }),
            hostExitReason:
              this.bootIssue ?? (signal ? "terminated" : "unexpected-exit"),
            outputPhase: "failed",
            outputActive: false,
            sourcesActive: false,
            videoSourceActive: false,
            audioSourceActive: false,
          };
        }
        pipe.close(
          this.bootIssue
            ? (nativeFailure(new Error(this.bootIssue)) as Error)
            : undefined,
        );
        if (this.child === child) {
          this.child = undefined;
          this.pipe = undefined;
        }
        if (this.context) {
          void this.stop().catch(() => {});
          this.ended("屏幕采集进程已退出，请重新选择共享来源");
        }
      });
      await pipe.call({ type: "status" });
      this.pipe = pipe;
      return pipe;
    })();
    try {
      return await this.boot;
    } finally {
      this.boot = undefined;
    }
  }
  async sources(): Promise<CaptureSource[]> {
    const epoch = this.selectionEpoch;
    const pipe = await this.ensure();
    const status = await pipe.call<Status>({ type: "status" });
    if (!status.screenPermission) {
      await pipe.call({ type: "requestPermission" });
      throw new Error(
        "请在系统设置 → 隐私与安全 → 录屏与系统录音中允许 CGScreenCaptureHost，退出并重新打开后重试",
      );
    }
    const data = z
      .object({
        windows: z.array(windowSchema),
        displays: z.array(displaySchema),
      })
      .parse(await pipe.call({ type: "windows" }));
    if (epoch !== this.selectionEpoch) return [];
    this.previewSources.clear();
    for (const d of data.displays) {
      const id = `native-screen:${d.displayId}`;
      this.previewSources.set(id, { id, displayId: d.displayId });
    }
    for (const w of data.windows.filter(
      (w) => w.bundleId !== this.ownApplication,
    )) {
      const id = `native:${w.windowId}:${w.pid}`;
      this.previewSources.set(id, { id, windowId: w.windowId, pid: w.pid });
    }
    return [
      ...data.displays.map((d) => ({
        id: `native-screen:${d.displayId}`,
        name: d.name,
        thumbnail: "",
        kind: "screen" as const,
      })),
      ...data.windows
        .filter((w) => w.bundleId !== this.ownApplication)
        .map((w) => ({
          id: `native:${w.windowId}:${w.pid}`,
          name: `${w.application}：${w.title}`,
          thumbnail: "",
          kind: "window" as const,
          application: w.application,
          applicationId: w.bundleId,
        })),
    ];
  }
  async sourceThumbnails(sourceIds: string[]): Promise<CaptureThumbnail[]> {
    const ids = z.array(z.string().max(256)).min(1).max(4).parse(sourceIds);
    const epoch = this.selectionEpoch;
    const sources = [...new Set(ids)].flatMap((id) => {
      const source = this.previewSources.get(id);
      return source ? [source] : [];
    });
    if (!sources.length) return [];
    const pipe = await this.ensure();
    if (epoch !== this.selectionEpoch) return [];
    const data = z
      .array(
        z.object({
          id: z.string().max(256),
          thumbnail: z
            .string()
            .max(55000)
            .refine(
              (value) =>
                value === "" ||
                /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value),
            ),
        }),
      )
      .max(4)
      .parse(
        await pipe
          .call<unknown>({ type: "thumbnails", sources })
          .then((raw) =>
            this.windows
              ? z.object({ items: z.unknown() }).parse(raw).items
              : raw,
          ),
      );
    if (epoch !== this.selectionEpoch) return [];
    return data.filter((preview) =>
      sources.some((source) => source.id === preview.id),
    );
  }
  async select(selection: CaptureSelection) {
    const epoch = ++this.selectionEpoch;
    const pipe = await this.ensure();
    const data = z
      .object({
        windows: z.array(windowSchema),
        displays: z.array(displaySchema),
      })
      .parse(await pipe.call({ type: "windows" }));
    if (epoch !== this.selectionEpoch) throw new Error("共享选择已取消");
    this.selection = selectNativeSource(
      selection,
      data.windows,
      data.displays,
      this.ownApplication,
    );
  }

  cancelSelection() {
    this.previewSources.clear();
    ++this.selectionEpoch;
    this.selection = undefined;
  }
  private async request(
    context: NativeCaptureRequest,
    suffix: string,
    method = "POST",
  ) {
    const response = await fetch(
      `${context.apiUrl}/api/v1/rooms/${context.roomId}/share-lease${suffix}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${context.sessionToken}`,
          "Content-Type": "application/json",
          "X-CineGather-Version": version,
          "X-CineGather-Platform": process.platform,
        },
        body: JSON.stringify({
          leaseId: context.lease.leaseId,
          revision: context.lease.revision,
        }),
        signal: AbortSignal.any([
          AbortSignal.timeout(8_000),
          ...(this.abort ? [this.abort.signal] : []),
        ]),
      },
    );
    if (!response.ok)
      throw new Error(
        response.status === 409
          ? "共享授权已失效，请重新共享"
          : "房间共享权限不可用，请重新连接",
      );
    return response.json();
  }
  async start(context: NativeCaptureRequest) {
    if (this.context) throw new Error("已有共享正在启动");
    const selection = this.selection;
    this.cancelSelection();
    if (!selection || selection.expiresAt <= Date.now())
      throw new Error("请选择共享窗口");
    const epoch = ++this.epoch;
    this.context = context;
    this.abort = new AbortController();
    try {
      const publication = nativePublicationSchema.parse(
        await this.request(context, "/native"),
      );
      const endpoint = new URL(publication.url);
      if (
        endpoint.username ||
        endpoint.password ||
        (!["https:"].includes(endpoint.protocol) &&
          !(
            endpoint.protocol === "http:" &&
            ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
          ))
      )
        throw new Error("推流服务必须使用 HTTPS 或本机地址");
      if (epoch !== this.epoch) throw new Error("共享已取消");
      const pipe = await this.ensure();
      if (epoch !== this.epoch) throw new Error("共享已取消");
      this.bootIssue = undefined;
      this.diagnosticStatus = {
        outputPhase: "starting",
        hostSession: this.hostSession,
      };
      const remainingMs = Math.min(
        30_000,
        Math.max(
          Date.parse(publication.expiresAt),
          Date.parse(context.lease.expiresAt),
        ) - Date.now(),
      );
      if (remainingMs <= 0) throw new Error("共享授权已过期");
      await pipe.call({
        type: "start",
        ...(this.windows
          ? { encoder: this.options.encoder?.() ?? "auto" }
          : {}),
        windowId: selection.window?.windowId,
        pid: selection.window?.pid,
        displayId: selection.displayId,
        application: selection.application,
        systemAudio: selection.systemAudio,
        excludedApplication: this.ownApplication,
        quality: context.quality,
        server: publication.url,
        token: publication.token,
        remainingMs,
      });
      this.started = true;
      this.activeWindow = selection.window;
      this.activeDisplayId = selection.displayId;
      const until = Date.now() + 12_000;
      while (epoch === this.epoch && Date.now() < until) {
        const status = await pipe.call<Status>({ type: "status" });
        this.rememberStatus(status);
        if (status.audioCaptureError) throw new Error(status.audioCaptureError);
        if (status.outputPhase === "failed" || status.outputPhase === "stopped")
          throw nativeFailure(
            new Error(
              this.diagnosticStatus?.transportFailure &&
              this.diagnosticStatus.transportFailure !== "none"
                ? this.diagnosticStatus.transportFailure
                : "原生推流未连接，请检查服务和采集权限",
            ),
          );
        if (status.outputPhase === "active" && status.sourceWidth > 0) {
          if (this.diagnosticStatus?.deviceAudioFallback)
            this.options.audioFallback?.();
          this.poll = setInterval(() => void this.check(), 1000);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error("共享启动已取消或超时");
    } catch (error) {
      if (epoch === this.epoch) await this.stop().catch(() => {});
      throw this.windows ? nativeFailure(error) : error;
    }
  }
  async switchSource() {
    const selection = this.selection,
      context = this.context;
    this.cancelSelection();
    if (
      !context ||
      !this.started ||
      !selection ||
      selection.expiresAt <= Date.now()
    )
      throw new Error("共享已停止或来源选择已失效");
    if (this.switching) throw new Error("正在切换共享来源");
    const epoch = this.epoch;
    this.switching = true;
    try {
      // Revalidate ownership/permissions without creating a new native ingress.
      await this.renew(context.lease);
      if (epoch !== this.epoch) throw new Error("共享已停止");
      const status = await this.pipe!.call<Status>({
        type: "switch-source",
        windowId: selection.window?.windowId,
        pid: selection.window?.pid,
        displayId: selection.displayId,
        application: selection.application,
        systemAudio: selection.systemAudio,
        excludedApplication: this.ownApplication,
      }).catch(() => {
        throw new Error(
          "新的共享来源不可用，请保持目标窗口展开后重新选择；原画面会继续共享",
        );
      });
      if (epoch !== this.epoch) throw new Error("共享已停止");
      this.activeWindow = selection.window;
      this.activeDisplayId = selection.displayId;
      this.rememberStatus(status);
      if (this.diagnosticStatus?.deviceAudioFallback)
        this.options.audioFallback?.();
    } finally {
      this.switching = false;
    }
  }
  async renew(lease: ShareLease): Promise<ShareLease> {
    const context = this.context;
    if (
      !context ||
      context.lease.leaseId !== lease.leaseId ||
      context.lease.revision !== lease.revision
    )
      throw new Error("共享已结束");
    const epoch = this.epoch;
    const next = leaseSchema.parse(await this.request(context, "/renew"));
    if (epoch !== this.epoch) throw new Error("共享已结束");
    if (this.started)
      await this.pipe!.call({
        type: "renew",
        remainingMs: Math.min(30_000, Date.parse(next.expiresAt) - Date.now()),
      });
    context.lease = next;
    return next;
  }
  private async check() {
    if (this.polling || this.switching || !this.context) return;
    this.polling = true;
    const epoch = this.epoch;
    try {
      const status = await this.pipe!.call<Status>({ type: "status" });
      if (epoch !== this.epoch) return;
      this.rememberStatus(status);
      if (
        ++this.checks % 5 === 0 &&
        (this.activeWindow || this.activeDisplayId)
      ) {
        const data = z
          .object({
            windows: z.array(windowSchema),
            displays: z.array(displaySchema),
          })
          .parse(await this.pipe!.call({ type: "windows" }));
        if (epoch !== this.epoch) return;
        if (
          this.activeDisplayId &&
          !data.displays.some((d) => d.displayId === this.activeDisplayId)
        )
          throw new Error("共享显示器已断开");
        if (
          this.activeWindow &&
          !data.windows.some(
            (w) =>
              w.windowId === this.activeWindow!.windowId &&
              w.pid === this.activeWindow!.pid,
          )
        )
          throw new Error("共享窗口已关闭");
      }
      if (
        Boolean(status.audioCaptureError) ||
        !status.screenPermission ||
        !status.outputActive ||
        !status.sourcesActive
      ) {
        await this.stop();
        this.ended(
          status.audioCaptureError
            ? "共享声音采集已中断，请检查声音权限后重新共享"
            : !status.screenPermission
              ? "屏幕录制权限已失效，请检查系统授权"
              : "共享采集已中断，请重新选择来源",
        );
      }
    } catch (error) {
      if (epoch === this.epoch) {
        await this.stop();
        this.ended(
          error instanceof Error &&
            ["共享显示器已断开", "共享窗口已关闭"].includes(error.message)
            ? error.message
            : "共享采集已中断，请重新选择来源",
        );
      }
    } finally {
      this.polling = false;
    }
  }
  async stop() {
    ++this.epoch;
    ++this.previewEpoch;
    this.previewId = undefined;
    clearInterval(this.poll);
    this.poll = undefined;
    const context = this.context;
    this.context = undefined;
    this.started = false;
    this.activeWindow = undefined;
    this.activeDisplayId = undefined;
    this.cancelSelection();
    this.abort?.abort();
    this.abort = undefined;
    try {
      if (this.pipe) {
        const status = nativeDiagnosticSchema.safeParse(
          await this.pipe.call({ type: "stop" }),
        );
        if (context)
          this.diagnosticStatus = status.success
            ? status.data
            : this.diagnosticStatus;
      }
    } finally {
      if (context) await this.request(context, "", "DELETE").catch(() => {});
    }
  }
  async shutdown() {
    await this.stop();
    const child = this.child;
    try {
      if (this.pipe) await this.pipe.call({ type: "shutdown" });
    } finally {
      child?.kill();
    }
  }
}
