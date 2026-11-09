import { expect, test } from "bun:test";
import { roomInvitationBase } from "../src/renderer/platform";
const publicApi = "https://cgplat.zqdesigned.city";
const desktop = { desktop: true, webOrigin: "app://cinegather" };
test("desktop invitations have a public web default without optional build variables", () => {
  expect(roomInvitationBase({ ...desktop, server: publicApi })).toBe(publicApi);
  expect(
    roomInvitationBase({
      ...desktop,
      server: publicApi,
      configuredWeb: "cinegather://join",
    }),
  ).toBe(publicApi);
  expect(
    roomInvitationBase({
      ...desktop,
      server: publicApi,
      configuredWeb: "invalid",
    }),
  ).toBe(publicApi);
});
test("a configured web host only applies to its matching API environment", () => {
  const configured = {
    ...desktop,
    configuredServer: publicApi,
    configuredWeb: "https://watch.example.com/app/",
  };
  expect(roomInvitationBase({ ...configured, server: publicApi })).toBe(
    configured.configuredWeb,
  );
  expect(
    roomInvitationBase({
      ...configured,
      server: "https://private.example.com",
    }),
  ).toBe("https://private.example.com");
  expect(
    roomInvitationBase({ ...desktop, server: "http://127.0.0.1:14310" }),
  ).toBe("http://127.0.0.1:14310");
});
test("web invitations use the page origin", () => {
  expect(
    roomInvitationBase({
      desktop: false,
      webOrigin: "http://127.0.0.1:5180",
      server: publicApi,
    }),
  ).toBe("http://127.0.0.1:5180");
});
