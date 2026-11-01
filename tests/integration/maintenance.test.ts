import { expect, test } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/api/src/app";
import { createApi, unwrap, ApiError } from "@cinegather/api-client";

test("maintenance gates every method and route before auth, limits, parsing and update policy; toggles without restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cg-maintenance-"));
  const file = join(dir, "maintenance.json");
  const app = await createApp({ maintenanceFile: file });
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  try {
    const healthy = await fetch(base + "/api/v1/health");
    expect(healthy.status).toBe(200);
    await healthy.text();
    const message = "服务器正在维护，预计 11 月 2 日 18:00 恢复，请稍后重试。";
    await writeFile(
      file,
      JSON.stringify({ message, expectedResumeAt: "2026-11-02T10:00:00.000Z" }),
    );
    for (const [method, path] of [
      ["GET", "/api/v1/health"],
      ["GET", "/api/v1/registration"],
      ["POST", "/api/v1/accounts/login"],
      ["PATCH", "/api/v1/admin/settings"],
      ["DELETE", "/api/v1/session"],
      ["GET", "/api/v1/client-policy"],
      ["GET", "/api/v1/mobile-updates/manifest"],
      ["POST", "/api/v1/livekit/webhook"],
      ["GET", "/no-such-route"],
    ]) {
      const response = await fetch(base + path, {
        method,
        headers: {
          Origin: "app://cinegather",
          "Content-Type": "application/json",
          "X-CineGather-Platform": "win32",
          "X-CineGather-Version": "0.0.0",
        },
        ...(["POST", "PATCH"].includes(method!)
          ? { body: "invalid json" }
          : {}),
      });
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("retry-after")).toBe("60");
      expect(response.headers.get("access-control-allow-origin")).toBe(
        "app://cinegather",
      );
      expect(await response.json()).toMatchObject({
        code: "SERVER_MAINTENANCE",
        message,
        expectedResumeAt: "2026-11-02T10:00:00.000Z",
        requestId: expect.any(String),
      });
    }
    const head = await fetch(base + "/api/v1/health", { method: "HEAD" });
    expect(head.status).toBe(503);
    expect(await head.text()).toBe("");
    // Cross-origin installed clients need a successful preflight before the
    // browser allows them to receive the actual request's maintenance message.
    const maintenancePreflight = await fetch(base + "/api/v1/rooms", {
      method: "OPTIONS",
      headers: {
        Origin: "app://cinegather",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });
    expect(maintenancePreflight.status).toBe(204);
    expect(
      maintenancePreflight.headers.get("access-control-allow-origin"),
    ).toBe("app://cinegather");
    const client = createApi(base, () => undefined);
    try {
      unwrap(await client.GET("/api/v1/registration"));
      throw Error("Expected maintenance error");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("SERVER_MAINTENANCE");
      expect((error as Error).message).toBe(message);
    }
    await writeFile(file, "incomplete operator configuration");
    const invalid = await fetch(base + "/api/v1/health");
    expect(invalid.status).toBe(503);
    expect((await invalid.json()).message).toContain("维护");
    await rm(file);
    const restored = await fetch(base + "/api/v1/health");
    expect(restored.status).toBe(200);
    await restored.text();
    const preflight = await fetch(base + "/api/v1/rooms", {
      method: "OPTIONS",
      headers: {
        Origin: "app://cinegather",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(preflight.status).toBe(204);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
