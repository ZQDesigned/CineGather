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
          "X-CineGather-Version,X-CineGather-Platform,X-CineGather-Features,X-CineGather-Protocols",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain(
      "X-CineGather-Version",
    );
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain(
      "X-CineGather-Protocols",
    );
  } finally {
    await app.close();
  }
});

test("native reverse-proxy preflight allows every compatibility header sent by desktop and mobile clients", async () => {
  const { protocolHeaders } = await import("@cinegather/contracts");
  const { readFile } = await import("node:fs/promises");
  const template = await readFile(
    new URL("../../infra/native/nginx-http.example.conf", import.meta.url),
    "utf8",
  );
  const declarations = [
    ...template.matchAll(/add_header Access-Control-Allow-Headers "([^"]+)"/g),
  ];
  expect(declarations.length).toBeGreaterThan(0);
  for (const match of declarations) {
    const allowed = new Set(
      match[1]!.split(",").map((name) => name.trim().toLowerCase()),
    );
    for (const name of [
      ...Object.keys(protocolHeaders),
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "X-CineGather-Version",
      "X-CineGather-Platform",
      "X-CineGather-Runtime",
      "X-CineGather-Build",
      "X-CineGather-Revision",
      "X-CineGather-Channel",
    ])
      expect(allowed.has(name.toLowerCase())).toBe(true);
  }
});
