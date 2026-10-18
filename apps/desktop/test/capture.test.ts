import { test, expect } from "bun:test";
import type {
  Session,
  Streams,
  DisplayMediaRequestHandlerOpts,
} from "electron";
import { configureDisplayCapture } from "../src/main/capture";

type Handler = NonNullable<
  Parameters<Session["setDisplayMediaRequestHandler"]>[0]
>;
const source = { id: "window:123:0", name: "Selected application" };
function capture(platform: NodeJS.Platform) {
  let handler!: Handler;
  let picker: DisplayMediaRequestHandlerOpts | undefined;
  let choice:
    | { sourceId: string; systemAudio: boolean; expiresAt: number }
    | undefined;
  let sources = [source];
  configureDisplayCapture(
    {
      setDisplayMediaRequestHandler(next, options) {
        handler = next!;
        picker = options;
      },
    },
    {
      platform,
      takeSelection: () => {
        const next = choice;
        choice = undefined;
        return next;
      },
      isTrustedRequest: (request) =>
        request.securityOrigin === "app://cinegather",
      getSources: async () => sources,
    },
  );
  return {
    picker,
    select(systemAudio = true, expiresAt = Date.now() + 20_000) {
      choice = { sourceId: source.id, systemAudio, expiresAt };
    },
    removeSource() {
      sources = [];
    },
    request(overrides: Partial<Parameters<Handler>[0]> = {}) {
      return new Promise<Streams | null>((resolve) =>
        handler(
          {
            frame: null,
            securityOrigin: "app://cinegather",
            videoRequested: true,
            audioRequested: true,
            userGesture: true,
            ...overrides,
          },
          resolve,
        ),
      );
    },
  };
}

test("Mac and Windows honor the in-app source and explicit audio choice without a second picker", async () => {
  for (const platform of ["darwin", "win32"] as const) {
    const broker = capture(platform);
    expect(broker.picker).toEqual({ useSystemPicker: false });
    broker.select();
    expect(await broker.request()).toEqual({
      video: source,
      audio: "loopback",
    });
    expect(await broker.request()).toBeNull();
    broker.select(false);
    expect(await broker.request()).toEqual({ video: source });
    broker.select();
    expect(await broker.request({ audioRequested: false })).toEqual({
      video: source,
    });
  }
});

test("capture denies missing, expired, untrusted and disappeared selections without granting a different source", async () => {
  const broker = capture("darwin");
  expect(await broker.request()).toBeNull();
  broker.select(true, Date.now() - 1);
  expect(await broker.request()).toBeNull();
  broker.select();
  expect(
    await broker.request({ securityOrigin: "https://evil.test" }),
  ).toBeNull();
  expect(await broker.request()).toBeNull();
  broker.select();
  expect(await broker.request({ userGesture: false })).toBeNull();
  broker.select();
  broker.removeSource();
  expect(await broker.request()).toBeNull();
});
