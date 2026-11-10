import type { DesktopUIIdentity } from "@cinegather/contracts";
let identity: DesktopUIIdentity | undefined;
let preparing = false;
let inFlight = 0;
export const hotNetworkActivity = (active: boolean) => {
  inFlight = Math.max(0, inFlight + (active ? 1 : -1));
};
export const desktopUIIdentity = () => identity;
export const hotPreparing = () => preparing;
export async function bootstrapDesktopUI() {
  identity = await window.desktop?.hotUpdates?.bootstrap();
}
export function trackHotUpdates(busy: () => boolean) {
  const bridge = window.desktop?.hotUpdates;
  if (!bridge || !identity) return () => {};
  const dirty = new Set<Element>();
  let disposed = false,
    lastBusy: boolean | undefined;
  const changed = (event: Event) => {
    if (
      event.target instanceof Element &&
      event.target.matches(
        "input:not([type=range]),textarea,[contenteditable=true]",
      )
    )
      dirty.add(event.target);
  };
  const blocked = () => {
    for (const element of dirty)
      if (!element.isConnected) dirty.delete(element);
    return (
      inFlight > 0 ||
      busy() ||
      dirty.size > 0 ||
      !!document.querySelector("[data-hot-update-busy]") ||
      [
        ...document.querySelectorAll('[role="dialog"], [aria-modal="true"]'),
      ].some((dialog) => !dialog.querySelector("[data-hot-update-safe]"))
    );
  };
  const publish = () => {
    const value = blocked();
    if (value !== lastBusy) {
      lastBusy = value;
      void bridge.activity(value).catch(() => {});
    }
    return value;
  };
  const freeze = (event: Event) => {
    if (preparing) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  document.addEventListener("input", changed, true);
  document.addEventListener("change", changed, true);
  for (const event of ["pointerdown", "keydown", "submit"])
    document.addEventListener(event, freeze, true);
  const timer = setInterval(() => {
    const active = publish();
    if (!active && !preparing)
      void bridge
        .status()
        .then((s) => {
          if (
            !disposed &&
            s?.phase === "ready" &&
            (s.required || document.hidden)
          )
            return bridge.apply();
        })
        .catch(() => {});
  }, 2000);
  const stopPrepare = bridge.onPrepare((id) => {
    preparing = true;
    const safe = !publish();
    void bridge.prepareResult({ id, safe }).catch(() => {});
  });
  const stopStatus = bridge.onChange((s) => {
    if (s.phase !== "applying") preparing = false;
  });
  publish();
  return () => {
    disposed = true;
    clearInterval(timer);
    stopPrepare();
    stopStatus();
    document.removeEventListener("input", changed, true);
    document.removeEventListener("change", changed, true);
    for (const event of ["pointerdown", "keydown", "submit"])
      document.removeEventListener(event, freeze, true);
  };
}
