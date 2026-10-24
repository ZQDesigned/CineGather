import { test, expect } from "bun:test";
import { createApp } from "../../apps/api/src/app";
import { readClientPolicy } from "../../apps/api/src/client-policy";
test("real API serves public compatibility policy, returns426 before incompatible workflows and preserves cleanup/CORS", async () => {
  const app = await createApp({
    clientPolicy: readClientPolicy({ CLIENT_MIN_VERSION_WINDOWS: "0.1.3" }),
  });
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  try {
    const policy = await fetch(`${base}/api/v1/client-policy`);
    expect(policy.status).toBe(200);
    expect((await policy.json()).minimumVersions.win32).toBe("0.1.3");
    const blocked = await fetch(`${base}/api/v1/rooms`, {
      method: "POST",
      headers: {
        "X-CineGather-Platform": "win32",
        "X-CineGather-Version": "0.1.2",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "must never be created" }),
    });
    expect(blocked.status).toBe(426);
    expect(blocked.headers.get("X-CineGather-Min-Version")).toBe("0.1.3");
    expect((await blocked.json()).code).toBe("CLIENT_UPDATE_REQUIRED");
    const allowed = await fetch(`${base}/api/v1/rooms`, {
      headers: {
        "X-CineGather-Platform": "win32",
        "X-CineGather-Version": "0.1.3",
      },
    });
    expect(allowed.status).toBe(401); // Passed compatibility; authentication still applies.
    const cleanup = await fetch(
      `${base}/api/v1/rooms/00000000-0000-4000-8000-000000000000/leave`,
      { method: "POST" },
    );
    expect(cleanup.status).toBe(401);
    const preflight = await fetch(`${base}/api/v1/rooms`, {
      method: "OPTIONS",
      headers: {
        Origin: "app://cinegather",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers":
          "X-CineGather-Version,X-CineGather-Platform",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain(
      "X-CineGather-Version",
    );
  } finally {
    await app.close();
  }
});
