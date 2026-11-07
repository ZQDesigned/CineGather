import { expect, test } from "bun:test";
import { WebSocketServer, WebSocket } from "ws";
import { once, EventEmitter } from "node:events";
import { startActivityHeartbeat } from "../src/activity-heartbeat";
async function pair(autoPong = true) {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const address = server.address();
  if (typeof address === "string" || !address) throw Error("No address");
  const connected = once(server, "connection");
  const client = new WebSocket(`ws://127.0.0.1:${address.port}`, { autoPong });
  await once(client, "open");
  const [peer] = (await connected) as [WebSocket];
  return {
    server,
    client,
    peer,
    async close() {
      client.terminate();
      peer.terminate();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
const wait = async (test: () => boolean) => {
  const end = Date.now() + 1000;
  while (!test()) {
    if (Date.now() > end) throw Error("Timed out");
    await Bun.sleep(5);
  }
};
test("idle protocol pings keep a legacy client alive without application messages or edits", async () => {
  const p = await pair();
  let pings = 0,
    messages = 0,
    expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const reset = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      expired = true;
      p.client.terminate();
    }, 100);
  };
  p.client.on("ping", () => {
    pings++;
    reset();
  });
  p.client.on("message", () => messages++);
  reset();
  const stop = startActivityHeartbeat(p.peer, 15);
  try {
    await wait(() => pings >= 10);
    expect(expired).toBe(false);
    expect(messages).toBe(0);
    expect(p.client.readyState).toBe(WebSocket.OPEN);
  } finally {
    clearTimeout(timer!);
    stop();
    await p.close();
  }
});
test("missing pong terminates a half-open connection and removes heartbeat listeners", async () => {
  // Fault injection: the native WebSocket client used by Bun always auto-pongs.
  const peer = Object.assign(new EventEmitter(), {
    readyState: 1,
    ping() {},
    terminate() {
      this.readyState = 3;
      this.emit("close");
    },
  });
  const closed = once(peer, "close");
  const stop = startActivityHeartbeat(peer as unknown as WebSocket, 10);
  try {
    await closed;
    expect(peer.readyState).toBe(WebSocket.CLOSED);
    expect(peer.listenerCount("pong")).toBe(0);
  } finally {
    stop();
  }
});
test("explicit cleanup cancels future pings without closing a live socket", async () => {
  const p = await pair();
  let pings = 0;
  p.client.on("ping", () => pings++);
  const stop = startActivityHeartbeat(p.peer, 10);
  try {
    await wait(() => pings >= 1);
    stop();
    await Bun.sleep(20);
    const count = pings;
    await Bun.sleep(40);
    expect(pings).toBe(count);
    expect(p.peer.listenerCount("pong")).toBe(0);
    expect(p.client.readyState).toBe(WebSocket.OPEN);
  } finally {
    await p.close();
  }
});
