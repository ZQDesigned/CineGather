import { createApi, unwrap, ApiError } from "@cinegather/api-client";
import {
  RoomCoordinator,
  ShareCoordinator,
  parseInvitation,
} from "@cinegather/client-core";
import { MediaSession } from "@cinegather/media-core";
import { DisconnectReason } from "livekit-client";
import type {
  CaptureSelection,
  DesktopSettings,
  RoomInfo,
  User,
} from "@cinegather/contracts";
import { state, update, defaults } from "./store";
import { serverOrigin } from "./server-address";
import {
  capabilities,
  defaultServer,
  readWebInvitation,
  platformSettings,
} from "./platform";
import { settingsSchema } from "../shared/settings";
import { FriendRequests } from "./friends";
import { ProcessAudio } from "./process-audio";
import {
  deviceAudioTitle,
  deviceAudioDescription,
} from "./audio-compatibility";
import { version } from "../../package.json";
import { versionBelow, clientPolicySchema } from "@cinegather/contracts";
let sessionToken = localStorage.getItem("cinegather.session") ?? undefined;
let changingCredentials = false;
const baseUrl = defaultServer(
  localStorage.getItem("cinegather.api"),
  import.meta.env.VITE_API_URL,
  location.origin,
  capabilities().desktop,
);
let webInvitation = !window.desktop
  ? readWebInvitation(location.href, (clean) =>
      history.replaceState(null, "", clean),
    )
  : undefined;
export function requireClientUpdate(minimumVersion: string, reason: string) {
  if (!versionBelow(version, minimumVersion)) return;
  const previous = state().requiredUpdate;
  if (previous && versionBelow(minimumVersion, previous.minimumVersion)) return;
  if (previous?.minimumVersion === minimumVersion && previous.reason === reason)
    return;
  update({ requiredUpdate: { minimumVersion, reason } });
  void window.desktop?.updates
    ?.requireUpdate?.(minimumVersion, reason)
    .catch(report);
}
export const api = createApi(baseUrl, () => sessionToken, {
  identity: {
    version,
    platform:
      window.desktop?.platform === "win32"
        ? "win32"
        : window.desktop?.platform === "darwin"
          ? "darwin"
          : "web",
  },
  onUpdateRequired: requireClientUpdate,
});
const friendRequests = new FriendRequests(
  () => sessionToken,
  async () => unwrap(await api.GET("/api/v1/friends")).items,
  (friends) => update({ friends }),
);
export const refreshFriends = () => friendRequests.refresh();
async function checkClientPolicy() {
  try {
    const response = await fetch(`${baseUrl}/api/v1/client-policy`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) return;
    const policy = clientPolicySchema.parse(await response.json());
    const platform = window.desktop?.platform;
    requireClientUpdate(
      policy.minimumVersions[
        platform === "win32" || platform === "darwin" ? platform : "web"
      ],
      policy.reason,
    );
  } catch {
    /* A failed check does not create or clear a compatibility requirement. */
  }
}
let selectResolve: ((accepted: boolean) => void) | undefined;
export async function copyText(value: string, notice?: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    throw new Error("无法写入剪贴板，请检查剪贴板权限后重试");
  }
  if (notice) update({ notice });
}
export function report(error: unknown) {
  if (error instanceof ApiError && error.code === "SCREEN_SHARE_UNAVAILABLE") {
    update({ modal: "share-unavailable", error: undefined });
    return;
  }
  if (
    error instanceof ApiError &&
    (error.staleSession ||
      (changingCredentials && error.status === 401) ||
      (!sessionToken && error.code === "UNAUTHENTICATED"))
  )
    return;
  if (error instanceof ApiError && error.status === 401) {
    const connected = Boolean(sessionToken && state().room);
    sessionToken = undefined;
    friendRequests.clear();
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
    const fallback = summary.microphoneNoise?.reason;
    if (fallback && !state().media.microphoneNoise?.reason)
      update({ notice: "增强降噪暂不可用，已使用基础降噪" });
    update({ media: summary });
    if (
      summary.state === "reconnecting" ||
      summary.state === "signalReconnecting"
    )
      update({ roomState: "reconnecting" });
    if (summary.state === "connected" && state().room)
      update({ roomState: "connected" });
  },
  report,
  () => {
    void stopShare();
  },
  (reason) => {
    if (changingCredentials) return;
    if (!state().room || ["idle", "leaving"].includes(state().roomState))
      return;
    if (reason === DisconnectReason.PARTICIPANT_REMOVED)
      void handleRemoteRemoval().catch(report);
    else
      update({ roomState: "failed", error: "媒体连接已断开，请重新连接房间" });
  },
);
async function handleRemoteRemoval() {
  const { room, roomRevision } = state();
  const identity = sessionToken;
  if (!room || !identity) return;
  update({ roomState: "leaving", modal: null, cinema: false });
  // The API read locks the room, so it observes the completed moderation transaction.
  const status = api
    .GET("/api/v1/rooms/{roomId}", {
      params: { path: { roomId: room.id } },
      signal: AbortSignal.timeout(5000),
    })
    .catch(() => undefined);
  await roomSession.leave(false);
  const result = await status;
  if (
    identity !== sessionToken ||
    state().room ||
    state().roomRevision !== roomRevision + 1
  )
    return;
  if (
    result?.error?.code === "SESSION_EXPIRED" ||
    result?.response.status === 401
  ) {
    report(
      new ApiError(
        result?.error?.code ?? "SESSION_EXPIRED",
        result?.error?.message ?? "登录已失效，请重新登录账号",
        401,
      ),
    );
    return;
  }
  const code = result?.error?.code;
  update({
    warning:
      code === "FORBIDDEN" || code === "ROOM_BANNED"
        ? "你已被房主移出房间"
        : code === "ROOM_NOT_FOUND"
          ? "房间已关闭"
          : "你已被服务器移出房间",
  });
  await refreshRooms();
}
const processAudio = new ProcessAudio((message) => {
  report(new Error(message));
  void shareSession.stop().catch(report);
});
export const shareSession: ShareCoordinator = new ShareCoordinator({
  acquire: async () =>
    unwrap(
      await api.POST("/api/v1/rooms/{roomId}/share-lease", {
        params: { path: { roomId: state().room!.id } },
      }),
    ),
  renew: async (lease) =>
    window.desktop?.nativeCapture &&
    ["publishing", "active"].includes(shareSession.state)
      ? window.desktop.renewNativeCapture!(lease)
      : unwrap(
          await api.POST("/api/v1/rooms/{roomId}/share-lease/renew", {
            params: { path: { roomId: state().room!.id } },
            body: { leaseId: lease.leaseId, revision: lease.revision },
          }),
        ),
  release: async (lease) => {
    if (state().room) {
      const result = await api.DELETE("/api/v1/rooms/{roomId}/share-lease", {
        params: { path: { roomId: state().room!.id } },
        body: { leaseId: lease.leaseId, revision: lease.revision },
      });
      if (![401, 403, 404].includes(result.response.status)) unwrap(result);
    }
  },
  select: async () => {
    if (!capabilities().sourcePicker) {
      update({ modal: "source", sources: [] });
      return new Promise<boolean>((resolve) => {
        selectResolve = resolve;
      });
    }
    const revision = state().shareRevision;
    const sources = await window.desktop!.sources();
    if (
      revision !== state().shareRevision ||
      state().shareState !== "selectingSource"
    )
      return false;
    if (!sources.length)
      throw new Error("未找到共享来源，请检查系统屏幕录制权限后重试");
    update({ sources, modal: "source" });
    return new Promise<boolean>((resolve) => {
      selectResolve = resolve;
    });
  },
  publish: async (lease) => {
    try {
      if (window.desktop?.nativeCapture) {
        if (!sessionToken || !state().room) throw new Error("请先进入房间");
        await window.desktop.startNativeCapture!({
          apiUrl: baseUrl,
          sessionToken,
          roomId: state().room!.id,
          lease,
          quality: state().settings.quality,
        });
        return;
      }
      if (window.desktop?.processAudio) {
        const revision = state().shareRevision;
        await media.share(state().settings.quality, false);
        if (
          shareSession.state !== "publishing" ||
          state().shareRevision !== revision
        )
          throw new Error("共享已取消");
        if (state().systemAudio) {
          const audio = await processAudio.start(window.desktop.processAudio);
          await media.publishShareAudio(audio.track);
          if (
            shareSession.state !== "publishing" ||
            state().shareRevision !== revision
          )
            throw new Error("共享已取消");
          if (audio.mode === "device")
            update({
              audioCompatibility: true,
              warningTitle: deviceAudioTitle,
              warning: deviceAudioDescription,
            });
        }
      } else if (capabilities().sourcePicker)
        await media.share(state().settings.quality, state().systemAudio);
      else await media.publishBrowserShare(state().settings.quality);
    } finally {
      await window.desktop?.cancelCapture();
    }
  },
  stop: async () => {
    update({ audioCompatibility: false });
    await processAudio.stop();
    await window.desktop?.stopNativeCapture?.();
    await media.stopShare();
    await window.desktop?.cancelCapture();
  },
  changed: (shareState, revision) => {
    update({ shareState, shareRevision: revision });
    void window.desktop?.setSharing(shareState === "active");
  },
  error: report,
});
const pttHolds = new Set<"window" | "global">();
export const roomSession = new RoomCoordinator({
  join: async (roomId, inviteToken, password) => {
    await window.desktop?.updates?.setInRoom(true);
    return unwrap(
      await api.POST("/api/v1/rooms/{roomId}/join", {
        params: { path: { roomId } },
        body: { inviteToken, password },
      }),
    );
  },
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
      await media.noiseReduction(state().settings.noiseReduction);
      await media.microphone(
        !(capabilities().pushToTalk && state().settings.pushToTalk),
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
  disconnect: () => {
    pttHolds.clear();
    return media.disconnect();
  },
  stopShare,
  changed: (roomState, room, revision) => {
    if (roomState === "idle" || (roomState === "failed" && !room))
      void window.desktop?.updates?.setInRoom(false).catch(report);
    update({
      roomState,
      roomRevision: revision,
      ...(room
        ? { room, modal: null }
        : roomState === "idle"
          ? { room: undefined }
          : {}),
    });
    if (roomState === "idle" && sessionToken) void refreshRooms().catch(report);
  },
  error: report,
});
function receiveInvitation(value: string) {
  update({
    joinValue: value,
    modal: state().user ? "join" : null,
    notice: state().user ? undefined : "收到房间邀请，请先注册或登录账号",
  });
}
export async function initialize() {
  await window.desktop?.updates?.setInRoom(Boolean(state().room)).catch(report);
  try {
    const loaded = window.desktop
      ? await window.desktop.loadSettings()
      : settingsSchema.parse(
          JSON.parse(localStorage.getItem("cinegather.settings") ?? "null") ??
            defaults,
        );
    const settings = platformSettings(loaded, capabilities().desktop);
    update({ settings });
    if (!window.desktop && loaded.pushToTalk)
      localStorage.setItem("cinegather.settings", JSON.stringify(settings));
  } catch {
    update({ settings: defaults });
  }
  if (sessionToken)
    await run(async () => {
      update({ user: unwrap(await api.GET("/api/v1/me")) });
      await refreshRooms();
      await refreshFriends();
    });
  try {
    const hotkeys = await window.desktop?.hotkeyStatus?.();
    if (hotkeys?.error) update({ error: hotkeys.error });
  } catch {
    update({ error: "无法检查全局快捷键状态；已保留你的按键说话设置。" });
  }
  const initial = (await window.desktop?.takeInvitation()) ?? webInvitation;
  webInvitation = undefined;
  if (initial) receiveInvitation(initial);
  const unsubscribe = window.desktop?.onAction((action, value) => {
    if (state().requiredUpdate && action !== "stop-share") return;
    if (action === "invite" && value) {
      receiveInvitation(value);
      void window.desktop?.takeInvitation();
    }
    if (action === "stop-share") void stopShare();
    if (action === "toggle-mute") void toggleMicrophone();
    if (action === "ptt-press") void ptt(true, "global");
    if (action === "ptt-release") void ptt(false, "global");
  });
  const timer = setInterval(() => void syncRooms(), 2500);
  void checkClientPolicy();
  const policyTimer = setInterval(() => void checkClientPolicy(), 30000);
  let refreshingFriends = false;
  const syncFriends = async () => {
    if (
      refreshingFriends ||
      !state().user ||
      state().requiredUpdate ||
      changingCredentials
    )
      return;
    refreshingFriends = true;
    try {
      await refreshFriends();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) report(error);
    } finally {
      refreshingFriends = false;
    }
  };
  const friendsTimer = setInterval(() => void syncFriends(), 5000);
  const focus = () => void syncFriends();
  window.addEventListener("focus", focus);
  return () => {
    clearInterval(timer);
    clearInterval(policyTimer);
    clearInterval(friendsTimer);
    window.removeEventListener("focus", focus);
    unsubscribe?.();
  };
}
let syncingRooms = false;
async function syncRooms() {
  if (
    syncingRooms ||
    state().requiredUpdate ||
    !sessionToken ||
    !state().user ||
    changingCredentials
  )
    return;
  syncingRooms = true;
  const identity = sessionToken;
  const { room, roomRevision } = state();
  try {
    await refreshRooms();
    const user = unwrap(await api.GET("/api/v1/me"));
    if (identity !== sessionToken) return;
    update({ user });
    if (!room || !["connected", "reconnecting"].includes(state().roomState))
      return;
    const current = unwrap(
      await api.GET("/api/v1/rooms/{roomId}", {
        params: { path: { roomId: room.id } },
      }),
    );
    if (state().room !== room || state().roomRevision !== roomRevision) return;
    const promoted = current.role === "owner" && state().room?.role !== "owner";
    update({ room: current, ...(promoted ? { notice: "你已成为房主" } : {}) });
  } catch (error) {
    if (identity !== sessionToken || changingCredentials) return;
    if (error instanceof ApiError && error.status === 401) report(error);
    else if (
      room &&
      state().room?.id === room.id &&
      state().roomRevision === roomRevision &&
      error instanceof ApiError &&
      [403, 404].includes(error.status)
    )
      await handleRemoteRemoval().catch(report);
  } finally {
    syncingRooms = false;
  }
}
async function acceptSession(data: { user: User; sessionToken: string }) {
  friendRequests.clear();
  sessionToken = data.sessionToken;
  localStorage.setItem("cinegather.session", data.sessionToken);
  update({ user: data.user, modal: null, error: undefined });
  await refreshRooms();
  await refreshFriends();
  if (state().joinValue) update({ modal: "join" });
}
export async function login(username: string, password: string) {
  await acceptSession(
    unwrap(
      await api.POST("/api/v1/accounts/login", {
        body: { username, password },
      }),
    ),
  );
}
export async function register(
  username: string,
  displayName: string,
  password: string,
) {
  if (state().user) await stopShare();
  changingCredentials = true;
  try {
    const result = unwrap(
      await api.POST("/api/v1/accounts/register", {
        body: { username, displayName, password },
      }),
    );
    await acceptSession(result);
    update({ notice: "账号已创建" });
  } catch (error) {
    if (error instanceof ApiError && error.code === "REGISTRATION_CLOSED")
      update({ registrationEnabled: false });
    throw error;
  } finally {
    changingCredentials = false;
  }
}
export async function changePassword(
  currentPassword: string,
  password: string,
) {
  changingCredentials = true;
  try {
    const result = unwrap(
      await api.POST("/api/v1/accounts/password", {
        body: { currentPassword, password },
      }),
    );
    await roomSession.leave(false);
    await acceptSession(result);
    update({ notice: "密码已修改，其他设备已退出登录" });
  } finally {
    changingCredentials = false;
  }
}
export async function refreshRooms() {
  const identity = sessionToken;
  const result = unwrap(await api.GET("/api/v1/rooms"));
  if (identity === sessionToken && state().user)
    update({ rooms: result.items });
}
export async function createRoom(
  name: string,
  maxMembers: number,
  access: "normal" | "password" = "normal",
  password?: string,
) {
  const room = unwrap(
    await api.POST("/api/v1/rooms", {
      body: {
        name,
        maxMembers,
        access,
        ...(access === "password" ? { password } : {}),
      },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    }),
  );
  await refreshRooms();
  await roomSession.enter(room.id);
}
export async function updateRoomSettings(name: string, maxMembers: number) {
  const { room, roomRevision } = state();
  const identity = sessionToken;
  if (!room) throw new Error("请先进入房间");
  const saved = unwrap(
    await api.POST("/api/v1/rooms/{roomId}/settings", {
      params: { path: { roomId: room.id } },
      body: { name, maxMembers },
    }),
  );
  if (
    identity !== sessionToken ||
    state().room?.id !== room.id ||
    state().roomRevision !== roomRevision
  )
    return;
  update({
    room: saved,
    rooms: state().rooms.map((r) =>
      r.id === saved.id
        ? { ...r, name: saved.name, maxMembers: saved.maxMembers }
        : r,
    ),
    ...(state().modal === "room-settings" ? { modal: null } : {}),
    notice: "房间设置已更新",
  });
}
export async function joinRoom(value: string, password?: string) {
  const { roomId, inviteToken } = parseInvitation(value);
  await roomSession.enter(
    roomId,
    inviteToken,
    inviteToken ? undefined : password || undefined,
  );
  await refreshRooms();
}
export async function retryRoom() {
  await roomSession.retry();
}
export async function enterKnownRoom(room: RoomInfo): Promise<boolean> {
  if (
    state().room?.id === room.id &&
    ["connected", "reconnecting"].includes(state().roomState)
  )
    return true;
  if (room.access === "password" && room.role !== "owner") {
    update({ joinValue: room.code, modal: "join" });
    return false;
  }
  await roomSession.enter(room.id);
  return state().roomState === "connected";
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
export async function ptt(
  enabled: boolean,
  source: "window" | "global" = "window",
) {
  if (!capabilities().pushToTalk) return;
  if (
    enabled &&
    state().settings.pushToTalk &&
    state().roomState === "connected"
  )
    pttHolds.add(source);
  else pttHolds.delete(source);
  if (
    state().settings.pushToTalk &&
    (state().roomState === "connected" ||
      (state().roomState === "reconnecting" && pttHolds.size === 0))
  )
    try {
      await media.microphone(pttHolds.size > 0, state().settings.inputDevice);
    } catch (error) {
      report(error);
    }
}
export async function chooseSource(selection?: CaptureSelection) {
  if (selection) await window.desktop?.selectSource(selection);
  update({
    modal: null,
    ...(selection ? { systemAudio: selection.systemAudio } : {}),
  });
  const resolve = selectResolve;
  selectResolve = undefined;
  resolve?.(Boolean(selection));
}
export async function chooseBrowserSource() {
  const revision = state().shareRevision;
  try {
    const selected = await media.selectBrowserShare(
      state().settings.quality,
      state().systemAudio,
    );
    if (
      revision !== state().shareRevision ||
      state().shareState !== "selectingSource"
    )
      return;
    update({ modal: null });
    const resolve = selectResolve;
    selectResolve = undefined;
    resolve?.(selected);
    if (selected && media.browserAudioNotice)
      update({
        warning: media.browserAudioNotice,
        warningTitle: "共享声音不可用",
      });
  } catch (error) {
    if (revision !== state().shareRevision) return;
    await chooseSource();
    if (
      error instanceof DOMException &&
      ["NotAllowedError", "AbortError"].includes(error.name)
    )
      update({ notice: "未开始共享，可重新选择或检查 Chrome 的共享权限" });
    else report(error);
  }
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
  settings = platformSettings(settings, capabilities().desktop);
  const held = pttHolds.size > 0;
  pttHolds.clear();
  if (
    (held || (settings.pushToTalk && !state().settings.pushToTalk)) &&
    ["connected", "reconnecting"].includes(state().roomState)
  )
    await media.microphone(false);
  if (window.desktop) await window.desktop.saveSettings(settings);
  else localStorage.setItem("cinegather.settings", JSON.stringify(settings));
  await media.devices(settings.inputDevice, settings.outputDevice);
  await media.noiseReduction(settings.noiseReduction);
  update({
    settings,
    notice:
      settings.noiseReduction === "enhanced" &&
      state().media.microphoneNoise?.reason
        ? "设置已保存，增强降噪暂不可用，已使用基础降噪"
        : "设置已保存",
    modal: null,
  });
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
    invite: invitationLink(roomId, invite.token),
    inviteId: invite.id,
    modal: "invite",
  });
}
function invitationLink(roomId: string, token: string) {
  const web = !window.desktop ? location.origin : import.meta.env.VITE_WEB_URL;
  if (web) {
    const url = new URL(web);
    if (["https:", "http:"].includes(url.protocol)) {
      url.searchParams.set("room", roomId);
      url.hash = new URLSearchParams({ invite: token }).toString();
      return url.href;
    }
  }
  return `cinegather://join?room=${roomId}&invite=${token}`;
}
export async function logout() {
  await roomSession.leave();
  unwrap(await api.DELETE("/api/v1/session"));
  sessionToken = undefined;
  friendRequests.clear();
  localStorage.removeItem("cinegather.session");
  update({ user: undefined, rooms: [] });
}
export function configureServer(url: string) {
  localStorage.setItem("cinegather.api", serverOrigin(url));
  localStorage.removeItem("cinegather.session");
  location.reload();
}
export { baseUrl };
