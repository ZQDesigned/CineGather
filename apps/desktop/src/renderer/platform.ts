import { serverOrigin } from "./server-address";
import { parseInvitation } from "@cinegather/client-core";

export function defaultServer(
  stored: string | null | undefined,
  configured: string | undefined,
  origin: string,
  desktop: boolean,
): string {
  for (const value of [stored, configured]) {
    if (value) {
      try {
        return serverOrigin(value);
      } catch {
        /* Ignore obsolete local settings. */
      }
    }
  }
  return desktop ? "http://127.0.0.1:14310" : origin;
}

export function capabilities() {
  const bridge = window.desktop;
  const secure = window.isSecureContext;
  return {
    desktop: Boolean(bridge),
    nativeCapture: Boolean(bridge?.nativeCapture),
    sourcePicker: Boolean(bridge?.sources),
    globalShortcuts: Boolean(bridge),
    tray: Boolean(bridge),
    microphone: Boolean(secure && navigator.mediaDevices?.getUserMedia),
    displayCapture: Boolean(
      bridge || (secure && navigator.mediaDevices?.getDisplayMedia),
    ),
    outputSelection: typeof HTMLMediaElement.prototype.setSinkId === "function",
    fullscreen: Boolean(
      document.fullscreenEnabled && document.documentElement.requestFullscreen,
    ),
    platform:
      bridge?.platform ??
      (/Mac/.test(navigator.platform) ? "darwin" : "browser"),
  };
}

export function readWebInvitation(
  href: string,
  replace: (clean: string) => void,
): string | undefined {
  const url = new URL(href);
  if (!url.searchParams.has("room")) return;
  const invitation = parseInvitation(href);
  if (!invitation.roomId) return;
  url.searchParams.delete("room");
  url.searchParams.delete("invite");
  const hash = new URLSearchParams(url.hash.slice(1));
  hash.delete("invite");
  url.hash = hash.toString();
  replace(url.href);
  return href;
}
