import type { DesktopBridge } from "@cinegather/contracts";
const bridgeUsers = new WeakMap<
  NonNullable<DesktopBridge["watchVisibility"]>,
  number
>();

// A native visibility event is authoritative on desktop. The DOM's visibility
// is deliberately kept visible there to preserve voice and shared-audio clocks.
export function bindWatchVisibility(deps: {
  bridge?: DesktopBridge["watchVisibility"];
  document: Document;
  setVideoVisible(visible: boolean): void;
  subscribeWatching(changed: (watching: boolean) => void): () => void;
  error(error: unknown): void;
}) {
  if (deps.bridge)
    bridgeUsers.set(deps.bridge, (bridgeUsers.get(deps.bridge) ?? 0) + 1);
  let stopped = false,
    revision = 0,
    events = 0,
    watching: boolean | undefined;
  const apply = (visible: boolean) => {
    if (!stopped) deps.setVideoVisible(visible);
  };
  const browserVisible = () =>
    apply(
      !deps.document.hidden || Boolean(deps.document.pictureInPictureElement),
    );
  const removeNative = deps.bridge?.onChange((visible) => {
    events++;
    apply(visible);
  });
  if (!deps.bridge) {
    for (const name of [
      "visibilitychange",
      "enterpictureinpicture",
      "leavepictureinpicture",
    ])
      deps.document.addEventListener(name, browserVisible, true);
    browserVisible();
  }
  const removeWatching = deps.subscribeWatching((selected) => {
    if (watching === selected || stopped) return;
    watching = selected;
    if (!deps.bridge) {
      browserVisible();
      return;
    }
    const current = ++revision,
      before = events;
    void deps.bridge
      .observe(selected)
      .then((visible) => {
        if (current === revision && before === events) apply(visible);
      })
      .catch((error) => {
        if (!stopped && current === revision) deps.error(error);
      });
  });
  return () => {
    if (stopped) return;
    stopped = true;
    ++revision;
    removeWatching();
    removeNative?.();
    if (deps.bridge) {
      const remaining = (bridgeUsers.get(deps.bridge) ?? 1) - 1;
      bridgeUsers.set(deps.bridge, remaining);
      if (!remaining) void deps.bridge.observe(false).catch(() => {});
    } else
      for (const name of [
        "visibilitychange",
        "enterpictureinpicture",
        "leavepictureinpicture",
      ])
        deps.document.removeEventListener(name, browserVisible, true);
  };
}
