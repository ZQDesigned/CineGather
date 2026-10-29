import {
  defaultNotificationPreferences,
  type ClientNotification,
  type NotificationRecord,
} from "@cinegather/contracts";
import {
  NotificationInbox,
  notificationDelivery,
} from "../shared/notifications";
import { state, update, useApp } from "./store";
import { RoomCuePlayer } from "./room-cues";
import cue from "./assets/notification.wav";

let origin = "",
  activeScope: string | undefined;
let activate: (item: NotificationRecord) => void = () => {};
let lastSound = -Infinity;
let leaving = false;
let bindingCount = 0;
let removeActivation: (() => void) | undefined;
const desktopTimes = new Map<string, number>();
const webNotices = new Map<string, Notification>();
export const notificationInbox = new NotificationInbox(
  {
    load: (key) =>
      JSON.parse(
        localStorage.getItem("cinegather.notifications:" + key) ?? "null",
      ),
    save: (key, value) =>
      localStorage.setItem(
        "cinegather.notifications:" + key,
        JSON.stringify(value),
      ),
  },
  (notifications) => {
    update({ notifications });
    void window.desktop?.notifications
      ?.unread(notifications.filter((item) => !item.read).length)
      .catch(() => {});
  },
);
const sound = new RoomCuePlayer({ notify: cue }, () => ({
  roomSounds: true,
  outputDevice: state().settings.outputDevice,
}));
function scope() {
  const next =
    state().user && origin ? `${origin}/${state().user!.id}` : undefined;
  if (next !== activeScope) {
    activeScope = next;
    desktopTimes.clear();
    sound.stop();
    for (const notification of webNotices.values()) notification.close();
    webNotices.clear();
    void window.desktop?.notifications?.clear().catch(() => {});
    notificationInbox.scope(next);
  }
  return next;
}
export function openClientNotification(
  id: string,
  expectedScope = activeScope,
) {
  if (!expectedScope || expectedScope !== scope()) return;
  const item = notificationInbox.snapshot().find((item) => item.id === id);
  if (!item) return;
  notificationInbox.read(id);
  if (item.active) activate(item);
}
export function publishClientNotification(event: ClientNotification) {
  if (leaving) return;
  const identity = scope();
  if (!identity || !notificationInbox.publish(event)) return;
  const prefs =
    state().settings.notifications ?? defaultNotificationPreferences;
  const now = performance.now();
  const delivery = notificationDelivery(prefs, event, {
    background: document.hidden || !document.hasFocus(),
    sharing:
      state().media.sharer?.local === true ||
      state().shareState === "publishing",
    now,
    lastSound,
  });
  if (delivery.sound) {
    lastSound = now;
    sound.play("notify", prefs.volume / 100);
  }
  const id = event.groupId ?? event.eventId;
  if (!delivery.desktop || now - (desktopTimes.get(id) ?? -Infinity) < 3000)
    return;
  desktopTimes.set(id, now);
  while (desktopTimes.size > 500)
    desktopTimes.delete(desktopTimes.keys().next().value!);
  const input = {
    id,
    scope: identity,
    title: delivery.title,
    body: delivery.body,
  };
  if (window.desktop?.notifications) {
    void window.desktop.notifications.show(input).catch(() => {});
  } else if (
    typeof Notification !== "undefined" &&
    Notification.permission === "granted"
  ) {
    try {
      webNotices.get(id)?.close();
      const notification = new Notification(input.title, {
        body: input.body,
        tag: id,
        silent: true,
        icon: document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.href,
      });
      webNotices.set(id, notification);
      while (webNotices.size > 20) {
        const oldest = webNotices.keys().next().value!;
        webNotices.get(oldest)?.close();
        webNotices.delete(oldest);
      }
      notification.onclick = () => {
        window.focus();
        openClientNotification(id, identity);
        notification.close();
      };
      notification.onclose = () => {
        if (webNotices.get(id) === notification) webNotices.delete(id);
      };
    } catch {
      /* The inbox and unread indicator remain available if permission changed. */
    }
  }
}
export function resolveClientNotification(id: string) {
  notificationInbox.resolve(id);
  webNotices.get(id)?.close();
  webNotices.delete(id);
}
export function clientNotificationEnabled(
  category: ClientNotification["category"],
) {
  const prefs =
    state().settings.notifications ?? defaultNotificationPreferences;
  return (
    prefs.enabled &&
    !prefs.doNotDisturb &&
    prefs[
      category === "chat" || category === "friends" || category === "system"
        ? category
        : "requests"
    ]
  );
}
export function previewNotificationSound(
  preferences = state().settings.notifications ??
    defaultNotificationPreferences,
) {
  sound.play("notify", preferences.volume / 100);
}
export function bindClientNotifications(
  server: string,
  onActivate: (item: NotificationRecord) => void,
) {
  const unloading = () => {
    leaving = true;
    sound.stop();
  };
  const restored = () => {
    leaving = false;
  };
  window.addEventListener("beforeunload", unloading);
  window.addEventListener("pagehide", unloading);
  window.addEventListener("pageshow", restored);
  ++bindingCount;
  origin = server;
  activate = onActivate;
  scope();
  const remove = useApp.subscribe((next, before) => {
    if (next.user?.id !== before.user?.id) scope();
    if (
      next.settings.notifications?.doNotDisturb &&
      !before.settings.notifications?.doNotDisturb
    ) {
      sound.stop();
      void window.desktop?.notifications?.clear().catch(() => {});
      for (const notice of webNotices.values()) notice.close();
      webNotices.clear();
    }
    if (next.chat.unread === 0 && before.chat.unread && next.room)
      notificationInbox.read("chat:" + next.room.id);
    if (next.room?.id !== before.room?.id && before.room)
      for (const item of notificationInbox.snapshot()) {
        if (
          item.roomId === before.room.id &&
          ["chat", "room", "share"].includes(item.target)
        )
          resolveClientNotification(item.id);
      }
    if (
      next.shareState === "publishing" &&
      before.shareState !== "publishing"
    ) {
      void window.desktop?.notifications?.clear().catch(() => {});
      for (const notice of webNotices.values()) notice.close();
      webNotices.clear();
    }
  });
  removeActivation ??= window.desktop?.notifications?.onActivate(
    openClientNotification,
  );
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    window.removeEventListener("beforeunload", unloading);
    window.removeEventListener("pagehide", unloading);
    window.removeEventListener("pageshow", restored);
    remove();
    if (--bindingCount === 0) {
      removeActivation?.();
      removeActivation = undefined;
      sound.stop();
    }
  };
}
