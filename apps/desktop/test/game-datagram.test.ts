import { expect, test } from "bun:test";
import { createSocket, type Socket as UDPSocket } from "node:dgram";
import { createConnection } from "node:net";
import { once } from "node:events";
import { GameDatagram } from "../src/main/game-datagram";

const grant = (id = crypto.randomUUID(), ttlMs = 10000) => ({
  id,
  revision: 1,
  ttlMs,
});
async function udp() {
  const s = createSocket("udp4");
  s.bind(0, "127.0.0.1");
  await once(s, "listening");
  return s;
}
async function exchange(s: UDPSocket, port: number, payload: Buffer) {
  const reply = once(s, "message");
  s.send(payload, port, "127.0.0.1");
  return (
    await Promise.race([
      reply,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Error("UDP timeout")), 1500),
      ),
    ])
  )[0] as Buffer;
}
test("datagram tunnels preserve empty/binary packet boundaries and isolate source endpoints", async () => {
  const game = await udp(),
    sources = new Set<number>();
  game.on("message", (packet, source) => {
    sources.add(source.port);
    game.send(packet, source.port, source.address);
  });
  const stats: {
    packetsSent?: number;
    packetsReceived?: number;
    bytesSent?: number;
    mappings?: number;
  }[] = [];
  const bridge = new GameDatagram({ event: (event) => stats.push(event) }),
    a = await udp(),
    b = await udp(),
    g = grant();
  try {
    const host = await bridge.createHost(g, game.address().port);
    const address = await bridge.createVisitor(g, host, 0);
    // Health frames target the tunnel lane, not the game's raw TCP listener.
    await bridge.probe(host);
    const port = Number(address.split(":")[1]);
    // macOS limits individual UDP payloads to udp.maxdgram (usually 9216).
    for (const packet of [
      Buffer.alloc(0),
      Buffer.from([0, 255, 1, 2]),
      Buffer.alloc(8000, 17),
    ])
      expect(await exchange(a, port, packet)).toEqual(packet);
    expect(await exchange(b, port, Buffer.from("second player"))).toEqual(
      Buffer.from("second player"),
    );
    expect(sources.size).toBe(2);
    await bridge.revoke(g.id);
    expect(
      stats.some(
        (event) =>
          event.packetsSent === 4 &&
          event.packetsReceived === 4 &&
          event.bytesSent === 8017,
      ),
    ).toBe(true);
    expect(
      stats
        .filter((event) => event.packetsSent === 4)
        .every((event) => event.mappings === 2),
    ).toBe(true);
    const socket = createConnection({
      host: "127.0.0.1",
      port: Number(host.split(":")[1]),
    });
    const [error] = await once(socket, "error");
    expect(error.code).toBe("ECONNREFUSED");
  } finally {
    await bridge.close();
    a.close();
    b.close();
    game.close();
  }
});

test("fixed UDP port conflicts are explicit and grants cannot reopen after revocation", async () => {
  const occupied = await udp(),
    bridge = new GameDatagram(),
    g = grant();
  try {
    await expect(
      bridge.createVisitor(g, "127.0.0.1:12345", occupied.address().port),
    ).rejects.toThrow("端口");
    await bridge.revoke(g.id);
    await expect(bridge.createHost(g, 24642)).rejects.toThrow("授权");
    await expect(bridge.createHost(grant(), 0)).rejects.toThrow();
  } finally {
    await bridge.close();
    occupied.close();
  }
});

test("invalid framing is closed without forwarding game payload and lease expiration closes listeners", async () => {
  const bridge = new GameDatagram(),
    game = await udp(),
    g = grant(crypto.randomUUID(), 180);
  let received = 0;
  game.on("message", () => received++);
  try {
    const host = await bridge.createHost(g, game.address().port);
    const s = createConnection({
      host: "127.0.0.1",
      port: Number(host.split(":")[1]),
    });
    await once(s, "connect");
    s.write(Buffer.from("CGD1\n\0\x7f\xff\xff\xff"));
    await once(s, "close");
    expect(received).toBe(0);
    await new Promise((r) => setTimeout(r, 220));
    await expect(bridge.probe(host)).rejects.toThrow();
  } finally {
    await bridge.close();
    game.close();
  }
});

test("split preambles and split/coalesced frames preserve packet boundaries", async () => {
  const game = await udp(),
    bridge = new GameDatagram();
  game.on("message", (p, r) => game.send(p, r.port, r.address));
  try {
    const host = await bridge.createHost(grant(), game.address().port),
      s = createConnection({
        host: "127.0.0.1",
        port: Number(host.split(":")[1]),
      });
    await once(s, "connect");
    s.write("CG");
    await new Promise((r) => setTimeout(r, 5));
    s.write("D1\n");
    const expected = Buffer.from([0, 0, 0, 0, 1, 97, 0, 0, 0, 0, 2, 0, 255]);
    const received = new Promise<Buffer>((resolve, reject) => {
      let result = Buffer.alloc(0);
      const t = setTimeout(() => reject(Error("frame timeout")), 1500);
      s.on("data", (p) => {
        result = Buffer.concat([result, p]);
        if (result.length >= expected.length) {
          clearTimeout(t);
          resolve(result);
        }
      });
    });
    s.write(Buffer.from([0, 0]));
    await new Promise((r) => setTimeout(r, 5));
    s.write(Buffer.from([0, 0, 1, 97, 0, 0, 0, 0, 2, 0, 255]));
    expect(await received).toEqual(expected);
    s.destroy();
  } finally {
    await bridge.close();
    game.close();
  }
});

test("a burst cannot enqueue unlimited UDP writes behind the tunnel stream", async () => {
  const game = await udp(),
    events: { code: string }[] = [],
    bridge = new GameDatagram({ event: (e) => events.push(e) });
  try {
    const host = await bridge.createHost(grant(), game.address().port),
      s = createConnection({
        host: "127.0.0.1",
        port: Number(host.split(":")[1]),
      });
    await once(s, "connect");
    const closed = once(s, "close");
    s.write(Buffer.concat([Buffer.from("CGD1\n"), Buffer.alloc(65 * 5)]));
    await Promise.race([
      closed,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("queue did not close")), 1000),
      ),
    ]);
    expect(events.some((e) => e.code === "QUEUE_LIMIT")).toBe(true);
  } finally {
    await bridge.close();
    game.close();
  }
});

test("delayed and dropped game-endpoint datagrams do not stall later packets or grow an unbounded queue", async () => {
  const game = await udp(),
    client = await udp(),
    bridge = new GameDatagram();
  let seen = 0;
  game.on("message", (p, r) => {
    seen++;
    if (seen % 10 === 0) return;
    setTimeout(() => game.send(p, r.port, r.address), 40);
  });
  try {
    const host = await bridge.createHost(grant(), game.address().port),
      address = await bridge.createVisitor(grant(), host, 0),
      port = Number(address.split(":")[1]);
    const received = new Promise<number[]>((resolve, reject) => {
      const result: number[] = [];
      const t = setTimeout(
        () => reject(Error("delayed packets stalled")),
        2000,
      );
      client.on("message", (p) => {
        result.push(p[0]!);
        if (result.length === 18) {
          clearTimeout(t);
          resolve(result.sort((a, b) => a - b));
        }
      });
    });
    for (let n = 0; n < 20; n++)
      client.send(Buffer.from([n]), port, "127.0.0.1");
    expect(await received).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    ]);
  } finally {
    await bridge.close();
    game.close();
    client.close();
  }
});
