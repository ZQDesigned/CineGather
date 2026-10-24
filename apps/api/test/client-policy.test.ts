import { test, expect } from "bun:test";
import { readClientPolicy, compatibilityFailure } from "../src/client-policy";
const policy = () =>
  readClientPolicy({
    CLIENT_MIN_VERSION_WINDOWS: "0.1.3",
    CLIENT_MIN_VERSION_MACOS: "0.1.2",
  });
test("compatibility cutoffs default off and invalid policy prevents startup", () => {
  expect(
    compatibilityFailure(
      "POST",
      "/api/v1/rooms",
      undefined,
      undefined,
      readClientPolicy({}),
    ),
  ).toBeUndefined();
  expect(() =>
    readClientPolicy({ CLIENT_MIN_VERSION_WINDOWS: "latest" }),
  ).toThrow();
});
test("business requests enforce the cutoff for the requesting platform and reject unknown legacy identities", () => {
  expect(
    compatibilityFailure("POST", "/api/v1/rooms", "win32", "0.1.2", policy())
      ?.minimumVersion,
  ).toBe("0.1.3");
  expect(
    compatibilityFailure("GET", "/api/v1/rooms", "win32", "0.1.3", policy()),
  ).toBeUndefined();
  expect(
    compatibilityFailure("POST", "/api/v1/rooms", "darwin", "0.1.2", policy()),
  ).toBeUndefined();
  expect(
    compatibilityFailure("POST", "/api/v1/rooms", "web", "0.1.1", policy()),
  ).toBeUndefined();
  expect(
    compatibilityFailure(
      "POST",
      "/api/v1/rooms",
      undefined,
      undefined,
      policy(),
    )?.minimumVersion,
  ).toBe("0.1.3");
  expect(
    compatibilityFailure("POST", "/api/v1/rooms", "win32", "garbage", policy())
      ?.minimumVersion,
  ).toBe("0.1.3");
});
test("outdated clients can still fetch policy, revoke sharing, leave and sign out", () => {
  for (const [method, path] of [
    ["GET", "/api/v1/client-policy"],
    ["GET", "/api/v1/health"],
    ["POST", "/api/v1/livekit/webhook"],
    ["DELETE", "/api/v1/session"],
    ["POST", "/api/v1/rooms/room-id/leave"],
    ["DELETE", "/api/v1/rooms/room-id/share-lease"],
  ]) {
    expect(
      compatibilityFailure(method!, path!, "win32", "0.1.0", policy()),
    ).toBeUndefined();
  }
  expect(
    compatibilityFailure(
      "POST",
      "/api/v1/rooms/room-id/share-lease/native",
      "win32",
      "0.1.0",
      policy(),
    ),
  ).toBeDefined();
});
