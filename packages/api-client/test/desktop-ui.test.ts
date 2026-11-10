import { test, expect } from "bun:test";
import { createApi } from "../src/index";
test("desktop UI identity uses existing allowed headers and forced-feature feedback does not trigger a full upgrade", async () => {
  let activity = 0,
    desktopPrompt = "",
    nativePrompt = false;
  const server = Bun.serve({
    port: 0,
    fetch: (req) => {
      expect(req.headers.get("X-CineGather-Runtime")).toBe("a".repeat(64));
      expect(req.headers.get("X-CineGather-Revision")).toBe("4");
      expect(req.headers.has("X-CineGather-Arch")).toBe(false);
      return Response.json(
        {
          code: "DESKTOP_UI_UPDATE_REQUIRED",
          message: "需要界面更新",
          requestId: "test",
        },
        { status: 426 },
      );
    },
  });
  try {
    const client = createApi(server.url.href, () => undefined, {
      identity: {
        platform: "win32",
        version: "0.1.42",
        desktop: {
          platform: "win32",
          arch: "x64",
          runtime: "a".repeat(64),
          revision: 4,
          bundleId: "b".repeat(64),
        },
      },
      onNetworkActivity: (active) => (activity += active ? 1 : -1),
      onDesktopUIRequired: (reason) => (desktopPrompt = reason),
      onUpdateRequired: () => (nativePrompt = true),
    });
    await client.GET("/api/v1/health");
    expect(activity).toBe(0);
    expect(desktopPrompt).toBe("需要界面更新");
    expect(nativePrompt).toBe(false);
  } finally {
    server.stop(true);
  }
});
test("failed API calls release the activation busy counter", async () => {
  let activity = 0;
  const client = createApi("http://127.0.0.1:1", () => undefined, {
    timeoutMs: 50,
    onNetworkActivity: (active) => (activity += active ? 1 : -1),
  });
  await expect(client.GET("/api/v1/health")).rejects.toThrow();
  expect(activity).toBe(0);
});
