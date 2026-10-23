import { expect, test } from "bun:test";
import { createApi, unwrap, ApiError } from "../src";
test("a late unauthorized response from an old token cannot revoke a newly logged-in session", async () => {
  let release!: () => void;
  let seen!: () => void;
  const requested = new Promise<void>((resolve) => {
    seen = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let token = "old-session";
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: async () => {
      seen();
      await pending;
      return Response.json(
        { code: "SESSION_EXPIRED", message: "expired", requestId: "test" },
        { status: 401 },
      );
    },
  });
  try {
    const api = createApi(server.url.origin, () => token);
    const response = api.GET("/api/v1/me");
    await requested;
    token = "new-session";
    release();
    let failure: ApiError | undefined;
    try {
      unwrap(await response);
    } catch (error) {
      if (error instanceof ApiError) failure = error;
      else throw error;
    }
    expect(failure?.staleSession).toBe(true);
  } finally {
    release();
    server.stop(true);
  }
});
