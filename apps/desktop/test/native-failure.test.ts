import { test, expect } from "bun:test";
import { nativeFailure } from "../src/main/native-failure";
test("native encoder failures explain recovery without silently changing the selected backend", () => {
  expect(
    (nativeFailure(new Error("encoder-adapter-reroute")) as Error).message,
  ).toContain("指定显卡");
  expect(
    (nativeFailure(new Error("encoder-initialization")) as Error).message,
  ).toContain("显卡驱动");
  const network = new Error("共享授权已失效");
  expect(nativeFailure(network)).toBe(network);
});
