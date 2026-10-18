import { test, expect } from "bun:test";
import { trustedURL, allowedExternal } from "../src/main/security";
test("IPC trust compares origin and rejects lookalike hosts and privileged external protocols", () => {
  expect(
    trustedURL("https://localhost:5173.evil.test/", "http://localhost:5173"),
  ).toBe(false);
  expect(
    trustedURL("http://localhost:5173/?next=evil", "http://localhost:5173"),
  ).toBe(true);
  expect(trustedURL("app://cinegather/index.html")).toBe(true);
  expect(trustedURL("app://cinegather.evil/index.html")).toBe(false);
  expect(allowedExternal("file:///etc/passwd")).toBe(false);
  expect(allowedExternal("javascript:alert(1)")).toBe(false);
  expect(allowedExternal("https://example.com")).toBe(true);
});
test("trusted pages may capture a microphone and explicitly selected screen, but never a camera", async () => {
  const { permissionAllowed } = await import("../src/main/security");
  expect(permissionAllowed("media", ["video"])).toBe(false);
  expect(permissionAllowed("media", ["audio"])).toBe(true);
  expect(permissionAllowed("media", ["audio", "video"])).toBe(false);
  expect(permissionAllowed("display-capture", ["video"])).toBe(true);
  expect(permissionAllowed("fullscreen")).toBe(true);
  expect(permissionAllowed("clipboard-sanitized-write")).toBe(true);
  expect(permissionAllowed("clipboard-read")).toBe(false);
});

test("Electron display capture with empty media types requires a live source approval and never authorizes a camera", async () => {
  const { permissionAllowed } = await import("../src/main/security");
  expect(permissionAllowed("media", [], true)).toBe(true);
  expect(permissionAllowed("media", [])).toBe(false);
  expect(permissionAllowed("media", undefined, true)).toBe(false);
  expect(permissionAllowed("media", ["video"], true)).toBe(false);
  expect(permissionAllowed("media", ["audio", "video"], true)).toBe(false);
});
