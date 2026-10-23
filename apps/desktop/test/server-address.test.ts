import { test, expect } from "bun:test";
import { serverOrigin } from "../src/renderer/server-address";

test("server settings normalize origins and reject credentials, paths and non-HTTP endpoints", () => {
  expect(serverOrigin(" https://example.com:443/ ")).toBe(
    "https://example.com",
  );
  expect(serverOrigin("http://127.0.0.1:14310")).toBe("http://127.0.0.1:14310");
  for (const value of [
    "",
    "not a URL",
    "file:///tmp/api",
    "https://guest:secret@example.com",
    "https://example.com/path",
    "https://example.com?token=secret",
    "https://example.com/#hash",
  ])
    expect(() => serverOrigin(value)).toThrow("API HTTP(S)");
});
