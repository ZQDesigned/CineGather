import { expect, test } from "bun:test";
import { cdnClientIp } from "../src/client-ip";
const resolve = cdnClientIp(["192.0.2.0/24", "2001:db8:1::/48"]);
test("CDN headers require both a trusted local proxy and a trusted CDN transport peer", () => {
  expect(resolve(true, "192.0.2.9", "198.51.100.3")).toBe("198.51.100.3");
  expect(resolve(false, "192.0.2.9", "198.51.100.3")).toBe("192.0.2.9");
  expect(resolve(true, "203.0.113.7", "198.51.100.3")).toBe("203.0.113.7");
  expect(resolve(true, "2001:db8:1::7", "2001:0db8:0002::1")).toBe(
    "2001:db8:2::1",
  );
});
test("malformed, chained or port-bearing client headers cannot create IP buckets", () => {
  for (const header of [
    undefined,
    "",
    "unknown",
    "198.51.100.3, 203.0.113.7",
    "198.51.100.3:8080",
    "[2001:db8::1]",
    " 198.51.100.3",
  ])
    expect(resolve(true, "192.0.2.9", header)).toBe("192.0.2.9");
  for (const range of [
    "0.0.0.0",
    "192.0.2.1/33",
    "::/129",
    "::/0/extra",
    "::/-1",
  ])
    expect(() => cdnClientIp([range])).toThrow();
});
