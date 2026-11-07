import { createConnection } from "node:net";
import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import { gamePortSchema, type GameWorld } from "@cinegather/contracts";

const MAX_PACKET = 65536;
const clean = (value: string, max = 128) =>
  Array.from(value, (character) => {
    const code = character.codePointAt(0)!;
    return code < 32 || code === 127 ? " " : character;
  })
    .join("")
    .replace(/§./g, "")
    .trim()
    .slice(0, max);
export function encodeGameVarInt(input: number) {
  let value = input >>> 0;
  const bytes: number[] = [];
  do {
    const byte = value & 127;
    value >>>= 7;
    bytes.push(value ? byte | 128 : byte);
  } while (value);
  return Buffer.from(bytes);
}
function readVarInt(
  buffer: Buffer,
  offset = 0,
): { value: number; bytes: number } | undefined {
  let value = 0;
  for (let n = 0; n < 5; n++) {
    const byte = buffer[offset + n];
    if (byte === undefined) return;
    if (n === 4 && byte > 15) throw Error("游戏响应无效");
    value |= (byte & 127) << (7 * n);
    if (!(byte & 128)) return { value, bytes: n + 1 };
  }
  throw Error("游戏响应无效");
}
function description(value: unknown, depth = 0): string {
  if (depth > 5) return "";
  if (typeof value === "string") return clean(value);
  if (Array.isArray(value))
    return value
      .slice(0, 16)
      .map((v) => description(v, depth + 1))
      .join("")
      .slice(0, 128);
  if (value && typeof value === "object") {
    const node = value as { text?: unknown; extra?: unknown };
    return (
      description(node.text, depth + 1) + description(node.extra, depth + 1)
    ).slice(0, 128);
  }
  return "";
}
export function parseMinecraftBeacon(
  bytes: Uint8Array,
  source: string,
  localAddresses: ReadonlySet<string>,
): { port: number; name: string } | undefined {
  if (bytes.byteLength > 2048 || !localAddresses.has(source)) return;
  const match = /^\[MOTD\]([\s\S]*)\[\/MOTD\]\[AD\]([0-9]{1,5})\[\/AD\]$/.exec(
    Buffer.from(bytes).toString("utf8"),
  );
  if (!match || !gamePortSchema.safeParse(Number(match[2])).success) return;
  return { port: Number(match[2]), name: clean(match[1]!) || "本机世界" };
}

export async function probeMinecraftWorld(
  port: number,
  {
    signal,
    timeoutMs = 2000,
  }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<GameWorld> {
  gamePortSchema.parse(port);
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw Error("游戏检测超时配置无效");
  if (signal?.aborted) throw new DOMException("已取消", "AbortError");
  return new Promise<GameWorld>((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let buffer = Buffer.alloc(0),
      done = false;
    const finish = (error?: Error, world?: GameWorld) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      socket.destroy();
      if (error) reject(error);
      else resolve(world!);
    };
    const abort = () => finish(new DOMException("已取消", "AbortError"));
    const timer = setTimeout(
      () =>
        finish(
          Error(
            "未检测到有效的 Minecraft Java 世界，请检查游戏中显示的局域网端口",
          ),
        ),
      timeoutMs,
    );
    timer.unref();
    signal?.addEventListener("abort", abort, { once: true });
    socket.once("error", () => finish(Error("无法连接这个本机游戏端口")));
    socket.once("end", () =>
      finish(Error("该端口未返回有效的 Minecraft Java 状态")),
    );
    socket.once("connect", () => {
      if (done) return;
      const name = Buffer.from("localhost"),
        portBytes = Buffer.alloc(2);
      portBytes.writeUInt16BE(port);
      const handshake = Buffer.concat([
        encodeGameVarInt(0),
        encodeGameVarInt(-1),
        encodeGameVarInt(name.length),
        name,
        portBytes,
        encodeGameVarInt(1),
      ]);
      socket.write(
        Buffer.concat([
          encodeGameVarInt(handshake.length),
          handshake,
          Buffer.from([1, 0]),
        ]),
      );
    });
    socket.on("data", (chunk: Buffer) => {
      if (done) return;
      if (buffer.length + chunk.length > MAX_PACKET + 5) {
        finish(Error("游戏状态响应过大"));
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const length = readVarInt(buffer);
        if (!length) return;
        if (length.value < 1 || length.value > MAX_PACKET)
          throw Error("游戏状态响应无效");
        if (buffer.length < length.bytes + length.value) return;
        const frame = buffer.subarray(
            length.bytes,
            length.bytes + length.value,
          ),
          id = readVarInt(frame);
        if (!id || id.value !== 0) throw Error("游戏状态响应无效");
        const text = readVarInt(frame, id.bytes);
        if (
          !text ||
          text.value <= 0 ||
          id.bytes + text.bytes + text.value !== frame.length
        )
          throw Error("游戏状态响应无效");
        const status: unknown = JSON.parse(
          frame.subarray(id.bytes + text.bytes).toString("utf8"),
        );
        if (!status || typeof status !== "object")
          throw Error("游戏状态响应无效");
        const { version, description: name } = status as {
          version?: { name?: unknown; protocol?: unknown };
          description?: unknown;
        };
        if (
          !version ||
          typeof version.name !== "string" ||
          version.name.length > 128 ||
          typeof version.protocol !== "number" ||
          !Number.isInteger(version.protocol)
        )
          throw Error("游戏状态响应无效");
        finish(undefined, {
          port,
          name: description(name) || "本机世界",
          version: clean(version.name, 64),
          protocol: version.protocol,
        });
      } catch {
        finish(Error("该端口未返回有效的 Minecraft Java 状态"));
      }
    });
  });
}

export async function discoverMinecraftWorlds({
  signal,
  durationMs = 3000,
}: { signal?: AbortSignal; durationMs?: number } = {}): Promise<GameWorld[]> {
  if (signal?.aborted) throw new DOMException("已取消", "AbortError");
  if (!Number.isFinite(durationMs) || durationMs < 1 || durationMs > 5000)
    throw Error("游戏发现超时配置无效");
  const addresses = new Set<string>(["127.0.0.1"]);
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? [])
      if (entry.family === "IPv4") addresses.add(entry.address);
  const socket = createSocket({ type: "udp4", reuseAddr: true }),
    ports = new Map<number, string>();
  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      try {
        socket.close();
      } catch {
        /* Bind may have been cancelled before a handle was created. */
      }
      if (error) reject(error);
      else resolve();
    };
    const abort = () => finish(new DOMException("已取消", "AbortError"));
    const timer = setTimeout(() => finish(), durationMs);
    timer.unref();
    signal?.addEventListener("abort", abort, { once: true });
    socket.on("error", () =>
      finish(Error("无法自动发现本机世界，请手动填写游戏中显示的端口")),
    );
    socket.on("message", (data, remote) => {
      const world = parseMinecraftBeacon(data, remote.address, addresses);
      if (world && ports.size < 16) ports.set(world.port, world.name);
    });
    socket.bind(4445, "0.0.0.0", () => {
      if (done) {
        try {
          socket.close();
        } catch {
          /* Cancellation may already have closed the discovery socket. */
        }
        return;
      }
      for (const address of addresses) {
        try {
          socket.addMembership("224.0.2.60", address);
        } catch {
          /* Try other local interfaces; manual entry remains available. */
        }
      }
    });
  });
  const found: GameWorld[] = [],
    entries = [...ports];
  for (let offset = 0; offset < entries.length; offset += 4) {
    if (signal?.aborted) throw new DOMException("已取消", "AbortError");
    const results = await Promise.allSettled(
      entries.slice(offset, offset + 4).map(async ([port, name]) => ({
        ...(await probeMinecraftWorld(port, { signal })),
        name,
      })),
    );
    for (const result of results)
      if (result.status === "fulfilled") found.push(result.value);
  }
  if (signal?.aborted) throw new DOMException("已取消", "AbortError");
  return found;
}
