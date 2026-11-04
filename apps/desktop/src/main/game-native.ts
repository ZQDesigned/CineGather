import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  gameTunnelConfigSchema,
  gamePortSchema,
  type GameTunnelConfig,
} from "@cinegather/contracts";
const bindingSchema = z.strictObject({
  memberId: z.uuid(),
  p2pPort: gamePortSchema,
  relayPort: gamePortSchema,
});
export const nativeGameConfigSchema = gameTunnelConfigSchema.extend({
  bindings: z.array(bindingSchema).max(7),
  visitorPort: z.number().int().min(0).max(65535),
});
export type NativeGameConfig = z.infer<typeof nativeGameConfigSchema>;
const eventSchema = z.strictObject({
  event: z.literal("transport"),
  state: z.enum(["connecting", "connected", "failed", "expired"]),
  phase: z.enum(["tls_dial", "lease", "control"]).optional(),
  code: z
    .string()
    .regex(/^[A-Z_0-9]{1,64}$/)
    .optional(),
  durationMs: z.number().int().min(0).max(60000).optional(),
});
export type GameNativeEvent =
  | z.infer<typeof eventSchema>
  | {
      event: "process";
      state: "started" | "exited";
      generation: number;
      code?: number | null;
    };
let nextNativeGeneration = 0;
export class GameNative {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private buffer = "";
  private generation = 0;
  private stopping = false;
  constructor(
    private options: {
      binaryPath: string;
      development?: boolean;
      caFile?: string;
      event?: (event: GameNativeEvent) => void;
    },
  ) {}
  get running() {
    return !!this.child && !this.child.killed;
  }
  private emit(event: GameNativeEvent) {
    try {
      this.options.event?.(event);
    } catch {
      /* observers do not control process cleanup */
    }
  }
  private boot() {
    if (this.child) return this.child;
    this.buffer = "";
    this.stopping = false;
    const generation = (this.generation = ++nextNativeGeneration);
    const child = spawn(this.options.binaryPath, [], {
      windowsHide: true,
      stdio: "pipe",
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        HOME: process.env.HOME,
        ...(this.options.development
          ? {
              CG_GAME_DEVELOPMENT: "1",
              ...(this.options.caFile
                ? { CG_GAME_DEVELOPMENT_CA: this.options.caFile }
                : {}),
            }
          : {}),
      },
    });
    this.child = child;
    this.emit({ event: "process", state: "started", generation });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (this.child !== child) return;
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 65536) {
        this.fail(new Error("联机进程返回了过大的响应"));
        return;
      }
      for (;;) {
        const pos = this.buffer.indexOf("\n");
        if (pos < 0) break;
        const line = this.buffer.slice(0, pos);
        this.buffer = this.buffer.slice(pos + 1);
        if (!line.trim()) continue;
        try {
          this.receive(JSON.parse(line));
        } catch {
          this.fail(new Error("联机进程响应格式无效"));
          return;
        }
      }
    });
    // Raw third-party diagnostics may contain addresses or credentials; consume without forwarding.
    child.stderr.resume();
    child.on("error", () => {
      if (this.child === child) this.fail(new Error("无法启动游戏联机组件"));
    });
    child.on("exit", (code) => {
      if (this.child === child) {
        this.child = undefined;
        this.rejectAll(new Error("游戏联机组件已退出"));
      }
      this.emit({ event: "process", state: "exited", generation, code });
    });
    return child;
  }
  private receive(raw: unknown) {
    const event = eventSchema.safeParse(raw);
    if (event.success) {
      this.emit(event.data);
      return;
    }
    const reply = z
      .strictObject({
        id: z.string().min(1).max(64),
        ok: z.boolean(),
        result: z.unknown().optional(),
        code: z
          .string()
          .regex(/^[A-Z_0-9]{1,64}$/)
          .optional(),
      })
      .parse(raw);
    const pending = this.pending.get(reply.id);
    if (!pending) return;
    this.pending.delete(reply.id);
    clearTimeout(pending.timer);
    if (reply.ok) pending.resolve(reply.result);
    else
      pending.reject(
        new Error(
          reply.code === "CONFIG_REJECTED"
            ? "游戏联机授权已失效或配置不匹配"
            : "游戏联机操作未完成",
        ),
      );
  }
  private rejectAll(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  private async terminate(child: ChildProcessWithoutNullStreams) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    let finished = false;
    const exited = new Promise<void>((resolve) =>
      child.once("close", () => {
        finished = true;
        resolve();
      }),
    );
    child.kill();
    const force = setTimeout(() => {
      if (!finished) child.kill("SIGKILL");
    }, 200);
    const limit = setTimeout(() => {
      if (!finished) child.kill("SIGKILL");
    }, 700);
    try {
      await Promise.race([
        exited,
        new Promise<void>((resolve) => setTimeout(resolve, 800)),
      ]);
    } finally {
      clearTimeout(force);
      clearTimeout(limit);
    }
  }
  private fail(error: Error) {
    const child = this.child;
    this.child = undefined;
    this.rejectAll(error);
    if (child) void this.terminate(child);
  }
  private call(op: "configure" | "stop", config?: NativeGameConfig) {
    const child = this.boot(),
      id = randomUUID();
    if (this.pending.size >= 8)
      return Promise.reject(new Error("游戏联机组件忙，请稍后重试"));
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error("游戏联机组件响应超时")),
        5000,
      );
      this.pending.set(id, { resolve, reject, timer });
      const raw =
        JSON.stringify({ id, version: 1, op, ...(config ? { config } : {}) }) +
        "\n";
      if (Buffer.byteLength(raw) > 65536) {
        this.fail(new Error("游戏联机配置过大"));
        return;
      }
      child.stdin.write(raw, (error) => {
        if (error && this.child === child)
          this.fail(new Error("无法连接游戏联机组件"));
      });
    });
  }
  configure(
    transport: GameTunnelConfig,
    bindings: NativeGameConfig["bindings"],
    visitorPort = 0,
  ) {
    if (this.stopping) return Promise.reject(new Error("游戏联机正在退出"));
    return this.call(
      "configure",
      nativeGameConfigSchema.parse({ ...transport, bindings, visitorPort }),
    );
  }
  async close() {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    try {
      await Promise.race([
        this.call("stop"),
        new Promise<void>((resolve) => setTimeout(resolve, 700)),
      ]);
    } catch {
      /* force shutdown below */
    }
    if (this.child === child) {
      this.child = undefined;
      this.rejectAll(new Error("游戏联机已停止"));
      await this.terminate(child);
    }
  }
}
