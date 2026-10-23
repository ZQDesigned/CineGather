import { expect, test } from "bun:test";
import { registrationDefault } from "../src/registration-config";
test("registration defaults closed and requires an explicit true to open", () => {
  expect(registrationDefault(undefined)).toBe(false);
  expect(registrationDefault("false")).toBe(false);
  expect(registrationDefault("true")).toBe(true);
  expect(() => registrationDefault("yes")).toThrow();
});
