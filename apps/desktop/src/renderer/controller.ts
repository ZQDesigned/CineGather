import { createApi, unwrap, ApiError } from "@cinegather/api-client";
import {
  RoomCoordinator,
  ShareCoordinator,
  parseInvitation,
} from "@cinegather/client-core";
import { MediaSession } from "@cinegather/media-core";
import type { CaptureSelection, DesktopSettings } from "@cinegather/contracts";
import { state, update, defaults } from "./store";
let sessionToken = localStorage.getItem("cinegather.session") ?? undefined;
const baseUrl =
  localStorage.getItem("cinegather.api") ??
  import.meta.env.VITE_API_URL ??
  "http://127.0.0.1:14310";
export const api = createApi(baseUrl, () => sessionToken);
let selectResolve: ((accepted: boolean) => void) | undefined;
export function report(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    const connected = Boolean(sessionToken && state().room);
    sessionToken = undefined;
    localStorage.removeItem("cinegather.session");
    update({ user: undefined });
    if (connected) {
      void media.disconnect();
      void roomSession.leave().catch(() => {});
    }
  }
  const messages: Record<string, string> = {
    TimeoutError: "请求超时，请检查服务器连接后重试",
    AbortError: "请求已取消或超时，请重试",
    NotAllowedError: "未获得设备或屏幕采集权限，请检查系统授权",
    NotFoundError: "未找到可用设备或共享来源",
    NotReadableError: "采集来源不可用，可能已关闭或被其他应用占用",
    NotSupportedError: "当前环境不支持此设备操作",
  };
  update({
    error:
      error instanceof Error
        ? (messages[error.name] ??
          (error.message.includes("Failed to get sources")
            ? "无法读取屏幕或窗口，请检查系统屏幕录制权限后重试"
            : error.message.replace(
                /^Error invoking remote method '[^']+': (?:Error: )?/,
                "",
              )))
        : "操作未完成，请重试",
  });
}
export async function run(work: () => Promise<void>) {
  update({ busy: true, error: undefined });
  try {
    await work();
  } catch (error) {
    report(error);
  } finally {
    update({ busy: false });
  }
}
export const media = new MediaSession(
  (summary) => {
    update({ media: summary });
    if (
      summary.state === "reconnecting" ||
      summary.state === "signalReconnecting"
    )
      update({ roomState: "reconnecting" });
    if (summary.state === "connected" && state().room)
      update({ roomState: "connected" });
    if (
      summary.state === "disconnected" &&
      state().room &&
      !["idle", "leaving"].includes(state().roomState)
    )
      update({ roomState: "failed", error: "媒体连接已断开，请重新连接房间" });
  },
  report,
  () => {
    void stopShare();
  },
);
export const shareSession = new ShareCoordinator({
  acquire: async () =>
    unwrap(
      await api.POST("/api/v1/rooms/{roomId}/share-lease", {
        params: { path: { roomId: state().room!.id } },
      }),
    ),
  renew: async (lease) =>
    unwrap(
      await api.POST("/api/v1/rooms/{roomId}/share-lease/renew", {
        params: { path: { roomId: state().room!.id } },
        body: { leaseId: lease.leaseId, revision: lease.revision },
      }),
    ),
  release: async (lease) => {
    if (state().room)
      unwrap(
        await api.DELETE("/api/v1/rooms/{roomId}/share-lease", {
          params: { path: { roomId: state().room!.id } },
          body: { leaseId: lease.leaseId, revision: lease.revision },
        }),
      );
  },
  select: async () => {
    if (!window.desktop) return true;
    const sources = await window.desktop.sources();
    if (!sources.length)
      throw new Error("未找到共享来源，请检查系统屏幕录制权限后重试");
    update({ sources, modal: "source" });
    return new Promise<boolean>((resolve) => {
      selectResolve = resolve;
    });
  },
  publish: async () => {
    try {
      await media.share(state().settings.quality, state().systemAudio);
    } finally {
      await window.desktop?.cancelCapture();
    }
  },
  stop: async () => {
    await media.stopShare();
    await window.desktop?.cancelCapture();
  },
  changed: (shareState, revision) => {
    update({ shareState, shareRevision: revision });
    void window.desktop?.setSharing(shareState === "active");
  },
  error: report,
});
export const roomSession = new RoomCoordinator({
  join: async (roomId, inviteToken) =>
    unwrap(
      await api.POST("/api/v1/rooms/{roomId}/join", {
        params: { path: { roomId } },
        body: { inviteToken },
      }),
    ),
  leave: async (roomId) => {
    unwrap(
      await api.POST("/api/v1/rooms/{roomId}/leave", {
        params: { path: { roomId } },
      }),
    );
  },
  connect: async (url, token) => {
    await media.connect(url, token);
    try {
      await media.microphone(
        !state().settings.pushToTalk,
        state().settings.inputDevice,
      );
      await media.devices(
        state().settings.inputDevice,
        state().settings.outputDevice,
      );
    } catch (error) {
      report(error);
    }
  },
  disconnect: () => media.disconnect(),
  stopShare,
  changed: (roomState, room, revision) => {
    update({
      roomState,
      roomRevision: revision,
      ...(room
        ? { room, modal: null }
        : roomState === "idle"
          ? { room: undefined }
          : {}),
    });
  },
  error: report,
});
function receiveInvitation(value: string) {
  update({
    joinValue: value,
    modal: state().user ? "join" : null,
    notice: state().user ? undefined : "收到房间邀请，请先输入昵称",
  });
}
export async function initialize() {
  try {
    const settings = window.desktop
      ? await window.desktop.loadSettings()
      : (JSON.parse(localStorage.getItem("cinegather.settings") ?? "null") ??
        defaults);
    update({ settings });
  } catch {
    update({ settings: defaults });
  }
  if (sessionToken)
    await run(async () => {
      update({ user: unwrap(await api.GET("/api/v1/me")) });
      await refreshRooms();
    });
  const initial = await window.desktop?.takeInvitation();
  if (initial) receiveInvitation(initial);
  return window.desktop?.onAction((action, value) => {
    if (action === "invite" && value) {
      receiveInvitation(value);
      void window.desktop?.takeInvitation();
    }
    if (action === "stop-share") void stopShare();
    if (
      action === "toggle-mute" ||
      (action === "ptt-toggle" && state().settings.pushToTalk)
    )
      void toggleMicrophone();
  });
}
export async function guest(displayName: string) {
  const data = unwrap(
    await api.POST("/api/v1/guests", { body: { displayName } }),
  );
  sessionToken = data.sessionToken;
  localStorage.setItem("cinegather.session", data.sessionToken);
  update({ user: data.user });
  await refreshRooms();
  if (state().joinValue) update({ modal: "join" });
}
export async function refreshRooms() {
  update({ rooms: unwrap(await api.GET("/api/v1/rooms")).items });
}
export async function createRoom(name: string, maxMembers: number) {
  const room = unwrap(
    await api.POST("/api/v1/rooms", {
      body: { name, maxMembers },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    }),
  );
  await refreshRooms();
  await roomSession.enter(room.id);
}
export async function joinRoom(value: string) {
  const { roomId, inviteToken } = parseInvitation(value);
  await roomSession.enter(roomId, inviteToken);
  await refreshRooms();
}
export async function retryRoom() {
  const room = state().room;
  if (room) await roomSession.enter(room.id);
}
export async function toggleMicrophone() {
  try {
    await media.microphone(
      !state().media.participants.find((p) => p.local)?.microphone,
      state().settings.inputDevice,
    );
  } catch (error) {
    report(error);
  }
}
export async function ptt(enabled: boolean) {
  if (state().roomState === "connected" && state().settings.pushToTalk)
    try {
      await media.microphone(enabled, state().settings.inputDevice);
    } catch (error) {
      report(error);
    }
}
export async function chooseSource(selection?: CaptureSelection) {
  if (selection) await window.desktop?.selectSource(selection);
  update({ modal: null });
  const resolve = selectResolve;
  selectResolve = undefined;
  resolve?.(Boolean(selection));
}
export async function stopShare() {
  if (selectResolve) {
    const resolve = selectResolve;
    selectResolve = undefined;
    resolve(false);
    update({ modal: null });
  }
  await shareSession.stop();
}
export async function saveSettings(settings: DesktopSettings) {
  if (window.desktop) await window.desktop.saveSettings(settings);
  else localStorage.setItem("cinegather.settings", JSON.stringify(settings));
  await media.devices(settings.inputDevice, settings.outputDevice);
  update({ settings, notice: "设置已保存", modal: null });
}
export async function createInvite() {
  const roomId = state().room!.id;
  const invite = unwrap(
    await api.POST("/api/v1/rooms/{roomId}/invites", {
      params: { path: { roomId } },
      body: { expiresInHours: 24, maxUses: 10 },
    }),
  );
  update({
    invite: `cinegather://join?room=${roomId}&invite=${invite.token}`,
    inviteId: invite.id,
    modal: "invite",
  });
}
export async function logout() {
  await roomSession.leave();
  unwrap(await api.DELETE("/api/v1/session"));
  sessionToken = undefined;
  localStorage.removeItem("cinegather.session");
  update({ user: undefined, rooms: [] });
}
export function configureServer(url: string) {
  const parsed = new URL(url);
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error("请输入有效的 API HTTP(S) 地址");
  localStorage.setItem("cinegather.api", parsed.origin);
  localStorage.removeItem("cinegather.session");
  location.reload();
}
export { baseUrl };
