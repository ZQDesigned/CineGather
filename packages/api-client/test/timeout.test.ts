import { test, expect } from "bun:test";
import { createApi } from "../src";
test("an unresponsive API is aborted at the configured deadline rather than leaving the client waiting", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch() {
      await Bun.sleep(300);
      return Response.json({ ok: true });
    },
  });
  try {
    const client = createApi(
      `http://127.0.0.1:${server.port}`,
      () => undefined,
      { timeoutMs: 30 },
    );
    let failure: unknown;
    try {
      await client.GET("/api/v1/health");
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
  } finally {
    server.stop(true);
  }
});
