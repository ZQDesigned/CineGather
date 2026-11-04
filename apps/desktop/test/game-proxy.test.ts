import { expect, test } from "bun:test";
import { createServer, createConnection, type Socket } from "node:net";
import { once } from "node:events";
import { GameProxy } from "../src/main/game-proxy";

async function echo(prefix = "") {
  const sockets = new Set<Socket>();
  const server = createServer((s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
    s.on("data", (data) =>
      s.write(prefix ? Buffer.concat([Buffer.from(prefix), data]) : data),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No TCP address");
  return {
    target: { host: "127.0.0.1" as const, port: address.port },
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
async function connect(address: string) {
  const socket = createConnection({
    host: "127.0.0.1",
    port: Number(address.split(":")[1]),
  });
  await once(socket, "connect");
  socket.on("error", () => {});
  return socket;
}
async function exchange(s: Socket, data: Buffer) {
  const result = once(s, "data");
  s.write(data);
  return (await result)[0] as Buffer;
}
const grant = (id = crypto.randomUUID(), ttlMs = 30000) => ({
  id,
  revision: 1,
  ttlMs,
});

test("real TCP forwarding exposes only a loopback game address and preserves arbitrary game bytes", async () => {
  const backend = await echo(),
    proxy = new GameProxy();
  try {
    const listener = await proxy.createVisitor({
      grant: grant(),
      target: backend.target,
    });
    expect(listener.address).toMatch(/^127\.0\.0\.1:\d+$/);
    const socket = await connect(listener.address),
      bytes = Buffer.from([0, 255, 1, 0, 128, 34, 13, 10]);
    expect(await exchange(socket, bytes)).toEqual(bytes);
    socket.destroy();
    await expect(
      proxy.createVisitor({
        grant: grant(),
        target: { host: "0.0.0.0", port: 123 } as never,
      }),
    ).rejects.toThrow();
  } finally {
    await proxy.close();
    await backend.close();
  }
});

test("removing one member destroys established game connections without disconnecting another member", async () => {
  const backend = await echo(),
    proxy = new GameProxy(),
    a = grant(),
    b = grant();
  try {
    const first = await proxy.createHostGateway({
      grant: a,
      target: backend.target,
      route: "p2p",
    });
    const second = await proxy.createHostGateway({
      grant: b,
      target: backend.target,
      route: "relay",
    });
    const one = await connect(first.address),
      two = await connect(second.address);
    expect(await exchange(one, Buffer.from("a"))).toEqual(Buffer.from("a"));
    const closed = once(one, "close");
    await proxy.revoke(a.id);
    await closed;
    expect(await exchange(two, Buffer.from("b"))).toEqual(Buffer.from("b"));
    await expect(
      proxy.createVisitor({ grant: a, target: backend.target }),
    ).rejects.toThrow();
    expect(proxy.renew(a.id, a.revision, 30000)).toBe(false);
    two.destroy();
  } finally {
    await proxy.close();
    await backend.close();
  }
});

test("changing an internal route retains the public address and does not migrate a live TCP stream", async () => {
  const a = await echo("old:"),
    b = await echo("new:"),
    proxy = new GameProxy();
  try {
    const listener = await proxy.createVisitor({
      grant: grant(),
      target: a.target,
    });
    const first = await connect(listener.address);
    expect((await exchange(first, Buffer.from("hello"))).toString()).toBe(
      "old:hello",
    );
    proxy.updateRoute(listener.id, b.target);
    const second = await connect(listener.address);
    expect((await exchange(first, Buffer.from("same"))).toString()).toBe(
      "old:same",
    );
    expect((await exchange(second, Buffer.from("route"))).toString()).toBe(
      "new:route",
    );
    first.destroy();
    second.destroy();
  } finally {
    await proxy.close();
    await a.close();
    await b.close();
  }
});

test("lease expiry closes active sockets and a delayed renewal cannot resurrect an expired member", async () => {
  const backend = await echo(),
    proxy = new GameProxy(),
    lease = grant(undefined, 100);
  try {
    const listener = await proxy.createVisitor({
      grant: lease,
      target: backend.target,
    });
    const socket = await connect(listener.address),
      closed = once(socket, "close");
    await closed;
    expect(proxy.renew(lease.id, lease.revision, 30000)).toBe(false);
    await expect(
      proxy.createVisitor({ grant: lease, target: backend.target }),
    ).rejects.toThrow();
  } finally {
    await proxy.close();
    await backend.close();
  }
});

test("revocation closes both P2P and relay gateways and records the observed route without game contents", async () => {
  const backend = await echo(),
    events: unknown[] = [],
    proxy = new GameProxy({ event: (e) => events.push(e) }),
    lease = grant();
  try {
    const p = await proxy.createHostGateway({
      grant: lease,
      target: backend.target,
      route: "p2p",
    });
    const r = await proxy.createHostGateway({
      grant: lease,
      target: backend.target,
      route: "relay",
    });
    const one = await connect(p.address),
      two = await connect(r.address);
    await exchange(one, Buffer.from("private-game-payload"));
    await exchange(two, Buffer.from("private-game-payload"));
    const a = once(one, "close"),
      b = once(two, "close");
    await proxy.revoke(lease.id);
    await Promise.all([a, b]);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "connected", route: "p2p" }),
        expect.objectContaining({ type: "connected", route: "relay" }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain("private-game-payload");
  } finally {
    await proxy.close();
    await backend.close();
  }
});

test("a listener being created cannot survive a concurrent member removal", async () => {
  const backend = await echo(),
    proxy = new GameProxy(),
    lease = grant();
  try {
    const pending = proxy.createVisitor({
      grant: lease,
      target: backend.target,
    });
    // Some runtimes finish the loopback bind synchronously. Both outcomes are
    // valid, but a listener returned before revocation must no longer be usable.
    const outcome = pending.then(
      (value) => value,
      () => undefined,
    );
    await proxy.revoke(lease.id);
    const listener = await outcome;
    if (listener) {
      const socket = createConnection({
        host: "127.0.0.1",
        port: Number(listener.address.split(":")[1]),
      });
      const failed = once(socket, "error");
      await failed;
      expect(socket.destroyed).toBe(true);
    }
    expect(proxy.renew(lease.id, 1, 30000)).toBe(false);
  } finally {
    await proxy.close();
    await backend.close();
  }
});

test("large transfers survive backpressure without changing game bytes", async () => {
  const backend = await echo(),
    proxy = new GameProxy();
  try {
    const listener = await proxy.createVisitor({
      grant: grant(),
      target: backend.target,
    });
    const socket = await connect(listener.address),
      bytes = Buffer.alloc(2 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    const result = new Promise<Buffer>((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      socket.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        size += chunk.length;
        if (size >= bytes.length) resolve(Buffer.concat(chunks));
      });
      socket.once("error", reject);
    });
    socket.pause();
    socket.write(bytes);
    setTimeout(() => socket.resume(), 30);
    expect(await result).toEqual(bytes);
    socket.destroy();
  } finally {
    await proxy.close();
    await backend.close();
  }
});
