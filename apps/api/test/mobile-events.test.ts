import { expect, test } from "bun:test";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { UpdateEvents } from "../src/update-events";
import { readClientPolicy } from "../src/client-policy";

test("mobile event connections receive policy and announcements without desktop release channels", async () => {
  const events = new UpdateEvents();
  const app = express();
  app.get("/events", (req, res) =>
    events.connect(req, res, () =>
      readClientPolicy({ CLIENT_MIN_VERSION_ANDROID: "0.1.0" }),
    ),
  );
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const platform of ["android", "ios"]) {
      const abort = new AbortController();
      try {
        const response = await fetch(
          `${origin}/events?platform=${platform}&arch=arm64`,
          {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(3000)]),
          },
        );
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(
          "text/event-stream",
        );
        const reader = response.body!.getReader();
        const first = await reader.read();
        expect(new TextDecoder().decode(first.value)).toContain(
          "event: policy",
        );
        await reader.cancel();
      } finally {
        abort.abort();
      }
    }
    expect(
      (await fetch(`${origin}/events?platform=untrusted&arch=arm64`)).status,
    ).toBe(400);
  } finally {
    events.onModuleDestroy();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
