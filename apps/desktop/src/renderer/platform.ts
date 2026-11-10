import { serverOrigin } from "./server-address";
import {
  clientUpdateOrigin,
  type DesktopSettings,
} from "@cinegather/contracts";

export function platformSettings(
  settings: DesktopSettings,
  desktop: boolean,
): DesktopSettings {
  return desktop ? settings : { ...settings, pushToTalk: false };
}

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
  return desktop ? clientUpdateOrigin : origin;
}

export function roomInvitationBase(options: {
  desktop: boolean;
  server: string;
  webOrigin: string;
  configuredServer?: string;
  configuredWeb?: string;
}) {
  if (!options.desktop) return options.webOrigin;
  const server = serverOrigin(options.server);
  const configured = defaultServer(
    undefined,
    options.configuredServer,
    options.webOrigin,
    true,
  );
  if (server === configured && options.configuredWeb) {
    try {
      const web = new URL(options.configuredWeb);
      if (
        ["https:", "http:"].includes(web.protocol) &&
        !web.username &&
        !web.password
      )
        return web.href;
    } catch {
      /* Use the current service when a build override is invalid. */
    }
  }
  return server;
}

export function capabilities() {
  const bridge = window.desktop;
  const secure = window.isSecureContext;
  return {
    desktop: Boolean(bridge),
    nativeCapture: Boolean(bridge?.nativeCapture),
    sourcePicker: Boolean(bridge?.sources),
    globalShortcuts: Boolean(bridge),
    pushToTalk: Boolean(bridge),
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

export { readWebInvitation } from "./features/rooms/web-invitation";
