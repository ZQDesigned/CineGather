import { expect, test } from "bun:test";
import { createServer, type Socket } from "node:net";
import { createSocket } from "node:dgram";
import {
  parseMinecraftBeacon,
  probeMinecraftWorld,
  encodeGameVarInt,
  discoverMinecraftWorlds,
} from "../src/main/games/minecraft-worlds";

test("LAN discovery accepts only bounded announcements originating on this computer", () => {
  const bytes = Buffer.from("[MOTD]自己的世界[/MOTD][AD]25565[/AD]");
  expect(
    parseMinecraftBeacon(bytes, "192.168.1.2", new Set(["192.168.1.2"]))?.port,
  ).toBe(25565);
  expect(
    parseMinecraftBeacon(bytes, "192.168.1.3", new Set(["192.168.1.2"])),
  ).toBeUndefined();
  for (const text of [
    "[MOTD]x[/MOTD][AD]0[/AD]",
    "[MOTD]x[/MOTD][AD]65536[/AD]",
    "[MOTD]x[/MOTD][AD]example.com:25565[/AD]",
    "x".repeat(3000),
  ])
    expect(
      parseMinecraftBeacon(
        Buffer.from(text),
        "127.0.0.1",
        new Set(["127.0.0.1"]),
      ),
    ).toBeUndefined();
});

async function fakeServer(
  mode: "minecraft" | "oversized" | "silent" | "other",
) {
  const sockets = new Set<Socket>();
  let sent = false;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.on("data", () => {
      if (sent) return;
      sent = true;
      if (mode === "silent") return;
      if (mode === "other") {
        socket.end("SSH-2.0-local-test\r\n");
        return;
      }
      if (mode === "oversized") {
        socket.write(encodeGameVarInt(128 * 1024));
        return;
      }
      const json = Buffer.from(
        JSON.stringify({
          version: { name: "1.21.4", protocol: 769 },
          description: { text: "本机测试世界" },
          players: { online: 0, max: 8 },
        }),
      );
      const body = Buffer.concat([
        Buffer.from([0]),
        encodeGameVarInt(json.length),
        json,
      ]);
      const framed = Buffer.concat([encodeGameVarInt(body.length), body]);
      socket.write(framed.subarray(0, 1));
      setTimeout(() => socket.write(framed.subarray(1)), 5);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw Error("No port");
  return {
    port: addr.port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

test("manual local ports require an actual Minecraft status handshake, including fragmented replies", async () => {
  const server = await fakeServer("minecraft");
  try {
    expect(await probeMinecraftWorld(server.port)).toEqual({
      port: server.port,
      name: "本机测试世界",
      version: "1.21.4",
      protocol: 769,
    });
  } finally {
    await server.close();
  }
});
test("non-game, oversized, unresponsive and cancelled probes are bounded and cannot become tunnel targets", async () => {
  for (const mode of ["other", "oversized", "silent"] as const) {
    const server = await fakeServer(mode);
    try {
      await expect(
        probeMinecraftWorld(server.port, { timeoutMs: 50 }),
      ).rejects.toThrow();
    } finally {
      await server.close();
    }
  }
  const server = await fakeServer("silent"),
    controller = new AbortController();
  try {
    const pending = probeMinecraftWorld(server.port, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toThrow();
  } finally {
    await server.close();
  }
  await expect(probeMinecraftWorld(65536)).rejects.toThrow();
});

test("real local UDP discovery verifies the advertised TCP service and releases its socket on cancellation", async () => {
  const server = await fakeServer("minecraft"),
    sender = createSocket("udp4");
  try {
    const pending = discoverMinecraftWorlds({ durationMs: 80 });
    await new Promise((r) => setTimeout(r, 15));
    await new Promise<void>((resolve, reject) =>
      sender.send(
        Buffer.from(`[MOTD]本机广播世界[/MOTD][AD]${server.port}[/AD]`),
        4445,
        "127.0.0.1",
        (e) => (e ? reject(e) : resolve()),
      ),
    );
    expect(await pending).toEqual(
      expect.arrayContaining([
        {
          port: server.port,
          name: "本机广播世界",
          version: "1.21.4",
          protocol: 769,
        },
      ]),
    );
    const abort = new AbortController(),
      cancelled = discoverMinecraftWorlds({
        signal: abort.signal,
        durationMs: 1000,
      });
    abort.abort();
    await expect(cancelled).rejects.toThrow();
    expect(
      (await discoverMinecraftWorlds({ durationMs: 10 })).some(
        (w) => w.port === server.port,
      ),
    ).toBe(false);
  } finally {
    sender.close();
    await server.close();
  }
});
