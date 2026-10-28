import { expect, test } from "bun:test";
import { bindWatchVisibility } from "../src/renderer/watch-visibility";
function surface() {
  const target = new EventTarget();
  const value = Object.assign(target, {
    hidden: false,
    pictureInPictureElement: null as object | null,
  }) as unknown as Document;
  return value;
}
test("web visibility pauses hidden video, but browser PiP keeps it active without focus checks", () => {
  const document = surface(),
    values: boolean[] = [];
  const stop = bindWatchVisibility({
    document,
    setVideoVisible: (v) => values.push(v),
    subscribeWatching: (changed) => {
      changed(true);
      return () => {};
    },
    error: () => {
      throw Error("unexpected");
    },
  });
  try {
    Object.defineProperty(document, "hidden", { value: true, writable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(values.at(-1)).toBe(false);
    Object.defineProperty(document, "pictureInPictureElement", {
      value: {},
      writable: true,
    });
    document.dispatchEvent(new Event("enterpictureinpicture"));
    expect(values.at(-1)).toBe(true);
    Object.defineProperty(document, "pictureInPictureElement", {
      value: null,
      writable: true,
    });
    document.dispatchEvent(new Event("leavepictureinpicture"));
    expect(values.at(-1)).toBe(false);
  } finally {
    stop();
  }
  const count = values.length;
  document.dispatchEvent(new Event("visibilitychange"));
  expect(values).toHaveLength(count);
});
test("new native events override old IPC replies and disposal disables sampling", async () => {
  const document = surface(),
    values: boolean[] = [],
    requests: boolean[] = [];
  let native: (visible: boolean) => void = () => {},
    watch: (selected: boolean) => void = () => {};
  const replies: ((visible: boolean) => void)[] = [];
  const stop = bindWatchVisibility({
    document,
    setVideoVisible: (v) => values.push(v),
    bridge: {
      onChange: (cb) => {
        native = cb;
        return () => {
          native = () => {};
        };
      },
      observe: (value) => {
        requests.push(value);
        return new Promise<boolean>((resolve) => replies.push(resolve));
      },
    },
    subscribeWatching: (changed) => {
      watch = changed;
      changed(true);
      return () => {
        watch = () => {};
      };
    },
    error: () => {
      throw Error("unexpected");
    },
  });
  native(false);
  replies[0]!(true);
  await Promise.resolve();
  expect(values).toEqual([false]);
  watch(false);
  watch(true);
  replies[1]!(false);
  replies[2]!(true);
  await Promise.resolve();
  expect(values.at(-1)).toBe(true);
  stop();
  expect(requests.at(-1)).toBe(false);
  const count = values.length;
  native(false);
  replies[3]!(false);
  await Promise.resolve();
  expect(values).toHaveLength(count);
});

test("disposing an older React binding cannot disable a still-active native watcher", () => {
  const requests: boolean[] = [];
  const bridge = {
    observe: async (value: boolean) => {
      requests.push(value);
      return true;
    },
    onChange: () => () => {},
  };
  const deps = {
    document: surface(),
    bridge,
    setVideoVisible: () => {},
    subscribeWatching: (changed: (value: boolean) => void) => {
      changed(true);
      return () => {};
    },
    error: () => {},
  };
  const old = bindWatchVisibility(deps),
    current = bindWatchVisibility(deps);
  old();
  expect(requests.at(-1)).toBe(true);
  current();
  expect(requests.at(-1)).toBe(false);
});
