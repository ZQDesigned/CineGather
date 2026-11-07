import WebSocket from "ws";
import assert from "node:assert/strict";
import { clientUpdateOrigin } from "@cinegather/contracts";

// Exercise the browser's actual Origin header. A native/no-Origin handshake
// alone does not verify that browsers can use room activities behind a CDN.
export function activityHandshake(endpoint: string, origin: string) {
  return new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(endpoint, {
      headers: { Origin: origin },
      handshakeTimeout: 8000,
    });
    ws.once("open", () => {
      resolve(101);
      ws.close();
    });
    ws.once("unexpected-response", (_, response) => {
      resolve(response.statusCode ?? 0);
      response.resume();
      ws.terminate();
    });
    ws.once("error", reject);
  });
}
export async function verifyWebActivityOrigin(
  origin: string = clientUpdateOrigin,
) {
  const url = new URL("/api/v1/room-activities/ws", origin);
  assert(["https:", "http:"].includes(url.protocol));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  assert.equal(
    await activityHandshake(url.toString(), new URL(origin).origin),
    101,
    "Browser Origin must be allowed by the production activity gateway",
  );
  assert.equal(
    await activityHandshake(url.toString(), "app://cinegather"),
    101,
  );
  assert.equal(
    await activityHandshake(url.toString(), "https://untrusted.invalid"),
    403,
    "Unknown web origins must remain rejected",
  );
}
if (import.meta.main) {
  const origin = process.argv[2] ?? clientUpdateOrigin;
  await verifyWebActivityOrigin(origin);
  console.log(
    "Web and desktop activity handshakes passed; unknown Origin rejected.",
  );
}
