import { test, expect } from "bun:test";
import { createApi } from "../src/index";
test("client identity is attached to requests and 426 invokes the mandatory-update hook", async () => {
  const received = new Map<string, string | null>();
  const required: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      received.set("platform", request.headers.get("X-CineGather-Platform"));
      received.set("version", request.headers.get("X-CineGather-Version"));
      return Response.json(
        {
          code: "CLIENT_UPDATE_REQUIRED",
          message: "共享协议已升级",
          requestId: "test",
        },
        { status: 426, headers: { "X-CineGather-Min-Version": "0.1.3" } },
      );
    },
  });
  try {
    const client = createApi(server.url.href, () => undefined, {
      identity: { version: "0.1.2", platform: "win32" },
      onUpdateRequired: (minimum, reason) => {
        required.push(minimum, reason);
      },
    });
    await client.GET("/api/v1/health");
    expect(received.get("platform")).toBe("win32");
    expect(received.get("version")).toBe("0.1.2");
    expect(required).toEqual(["0.1.3", "共享协议已升级"]);
  } finally {
    server.stop(true);
  }
});
test("feature rejection carries its own update requirement and never invokes global update callbacks", async () => {
  const { FeatureUpdateError, unwrap } = await import("../src/index");
  let forced = 0;
  const issue = {
    scope: "feature",
    feature: "screen.publish",
    protocol: 2,
    reason: "共享功能需要更新",
    updateKind: "desktop",
    minimumVersion: "0.1.99",
  };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () =>
      Response.json(
        {
          code: "FEATURE_UPDATE_REQUIRED",
          message: issue.reason,
          requestId: "scoped",
          compatibility: issue,
        },
        {
          status: 426,
          headers: {
            "X-CineGather-Update-Scope": "feature",
            "X-CineGather-Min-Version": "0.1.99",
          },
        },
      ),
  });
  try {
    const c = createApi(server.url.href, () => undefined, {
      onUpdateRequired: () => forced++,
    });
    const result = await c.GET("/api/v1/health");
    expect(() => unwrap(result)).toThrow(FeatureUpdateError);
    expect(forced).toBe(0);
  } finally {
    server.stop(true);
  }
});
