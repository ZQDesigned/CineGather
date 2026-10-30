import { expect, test } from "bun:test";
import { MobileApi } from "../src/mobile-api";
import { ApiError } from "@cinegather/api-client";

const health = {
  ok: true as const,
  database: "up" as const,
  media: "up" as const,
  version: "0.1.0",
  runtime: "test",
};

test("mobile transport sends its native identity and does not log bearer credentials or response bodies", async () => {
  const headers: Array<[string | null, string | null, string | null]> = [];
  const trace: unknown[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      headers.push([
        req.headers.get("X-CineGather-Platform"),
        req.headers.get("X-CineGather-Version"),
        req.headers.get("Authorization"),
      ]);
      return Response.json(health);
    },
  });
  try {
    const api = new MobileApi({
      origin: server.url.href,
      platform: "android",
      version: "0.1.26",
      getToken: () => "private-session",
      expire: async () => true,
      trace: (e) => {
        trace.push(e);
      },
    });
    expect(await api.call("health", (c) => c.GET("/api/v1/health"))).toEqual(
      health,
    );
    expect(headers).toEqual([["android", "0.1.26", "Bearer private-session"]]);
    expect(trace).toHaveLength(1);
    expect(JSON.stringify(trace)).not.toContain("private-session");
    expect(JSON.stringify(trace)).not.toContain('"database"');
  } finally {
    server.stop(true);
  }
});

test("a delayed unauthorized response cannot invalidate a newer mobile login", async () => {
  let token = "old",
    release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  let entered!: () => void;
  const began = new Promise<void>((r) => {
    entered = r;
  });
  let expired = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch() {
      entered();
      await wait;
      return Response.json(
        { code: "SESSION_EXPIRED", message: "expired", requestId: "test" },
        { status: 401 },
      );
    },
  });
  try {
    const api = new MobileApi({
      origin: server.url.href,
      platform: "ios",
      version: "0.1.26",
      getToken: () => token,
      expire: async () => {
        expired++;
        token = "";
        return true;
      },
    });
    const pending = api.call("me", (c) => c.GET("/api/v1/me")).catch((e) => e);
    await began;
    token = "new";
    release();
    const error = await pending;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).staleSession).toBe(true);
    expect(token).toBe("new");
    expect(expired).toBe(0);
  } finally {
    release();
    server.stop(true);
  }
});

test("only authoritative401 invalidates a mobile session, including during an explicit-token revoke", async () => {
  let token: string | undefined = "active",
    status = 503,
    expired = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return Response.json(
        { code: "FAILED", message: "failed", requestId: "test" },
        { status },
      );
    },
  });
  try {
    const api = new MobileApi({
      origin: server.url.href,
      platform: "ios",
      version: "0.1.26",
      getToken: () => token,
      expire: async (expected) => {
        expect(expected).toBe("active");
        expired++;
        token = undefined;
        return true;
      },
    });
    await expect(
      api.call("me", (c) => c.GET("/api/v1/me")),
    ).rejects.toMatchObject({ status: 503 });
    expect(expired).toBe(0);
    status = 401;
    await expect(
      api.call("logout", (c) => c.DELETE("/api/v1/session"), {
        token: "old",
        invalidate: false,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(expired).toBe(0);
    await expect(
      api.call("me", (c) => c.GET("/api/v1/me")),
    ).rejects.toMatchObject({ status: 401 });
    expect(expired).toBe(1);
    expect(token).toBeUndefined();
  } finally {
    server.stop(true);
  }
});
