import { test, expect } from "bun:test";
import type {
  Session,
  Streams,
  DisplayMediaRequestHandlerOpts,
} from "electron";
import { configureDisplayCapture } from "../src/main/capture";
import type { CaptureSelection } from "@cinegather/contracts";

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
  let trusted = true;
  const grants: CaptureSelection[] = [];
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
        trusted && request.securityOrigin === "app://cinegather",
      getSources: async () => sources,
      grantAudio: (selection) => grants.push(selection),
    },
  );
  return {
    picker,
    grants,
    block() {
      trusted = false;
    },
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

test("in-app capture never grants Windows system loopback for an application window", async () => {
  for (const platform of ["darwin", "win32"] as const) {
    const broker = capture(platform);
    expect(broker.picker).toEqual({ useSystemPicker: false });
    broker.select();
    expect(await broker.request()).toEqual({
      video: source,
      ...(platform === "darwin" ? { audio: "loopback" } : {}),
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

test("a lock during source lookup cannot grant native process audio", async () => {
  const broker = capture("win32");
  broker.select();
  const request = broker.request();
  broker.block();
  expect(await request).toBeNull();
  expect(broker.grants).toHaveLength(0);
  const valid = capture("win32");
  valid.select();
  await valid.request();
  expect(valid.grants).toHaveLength(1);
  await valid.request();
  expect(valid.grants).toHaveLength(1);
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
