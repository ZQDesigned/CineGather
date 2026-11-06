import { expect, test } from "bun:test";
import { Resvg } from "@resvg/resvg-js";
import { validateBoardPng } from "../src/whiteboard-images";
const png = () =>
  Buffer.from(
    new Resvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="red"/></svg>',
    )
      .render()
      .asPng(),
  );
const data = (bytes: Buffer) =>
  "data:image/png;base64," + bytes.toString("base64");
test("accepts normalized static PNG and rejects truncated, oversized and corrupted images", () => {
  const bytes = png();
  expect(validateBoardPng(data(bytes))).toEqual({ width: 40, height: 30 });
  expect(() =>
    validateBoardPng("data:image/svg+xml;base64,PHN2Zz4="),
  ).toThrow();
  expect(() =>
    validateBoardPng(data(bytes.subarray(0, bytes.length - 8))),
  ).toThrow();
  const oversized = Buffer.from(bytes);
  oversized.writeUInt32BE(4097, 16);
  expect(() => validateBoardPng(data(oversized))).toThrow();
  const damaged = Buffer.from(bytes);
  damaged[29] = damaged[29]! ^ 1;
  expect(() => validateBoardPng(data(damaged))).toThrow();
});
