import { reconcileAudioDevices } from "./audio-devices";
import { RoomCuePlayer, RoomPresenceCues } from "./room-cues";
import enterCue from "./assets/room-enter.wav";
import leaveCue from "./assets/room-leave.wav";
import { createApi, unwrap, ApiError } from "@cinegather/api-client";
import {
  RoomCoordinator,
  RoomChat,
  ShareCoordinator,
  parseInvitation,
  watchUpdateEvents,
} from "@cinegather/client-core";
import { Accompaniment, MediaSession } from "@cinegather/media-core";
import { DisconnectReason } from "livekit-client";
import type {
  CaptureSelection,
  DesktopSettings,
  RoomInfo,
  User,
  RoomInvitation,
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
import { DiagnosticRecorder } from "./diagnostic-recorder";
import { ProcessAudio } from "./process-audio";
import {
  deviceAudioTitle,
  deviceAudioDescription,
} from "./audio-compatibility";
import { version } from "../../package.json";
import {
  versionBelow,
  clientPolicySchema,
  clientUpdateOrigin,
} from "@cinegather/contracts";
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
  async () => unwrap(await api.GET("/api/v1/friends")),
  (friends, roomInvitations) => update({ friends, roomInvitations }),
);
export const refreshFriends = () => friendRequests.refresh();
let presenceRevision = 0;
let presenceSyncing = false;
async function syncPresence(acceptingSession = false) {
  const identity = sessionToken;
  if (
    !identity ||
    !state().user ||
    (changingCredentials && !acceptingSession) ||
    state().requiredUpdate ||
    presenceSyncing
  )
    return;
  presenceSyncing = true;
  const revision = presenceRevision;
  try {
    const result = unwrap(await api.POST("/api/v1/presence/heartbeat"));
    if (sessionToken === identity && revision === presenceRevision)
      update({ presenceVisibility: result.visibility });
  } catch (error) {
    if (
      sessionToken === identity &&
      error instanceof ApiError &&
      error.status === 401
    )
      report(error);
  } finally {
    presenceSyncing = false;
  }
}
export async function setPresence(visibility: "online" | "invisible") {
  const identity = sessionToken;
  const revision = ++presenceRevision;
  const result = unwrap(
    await api.POST("/api/v1/presence", { body: { visibility } }),
  );
  if (sessionToken === identity && revision === presenceRevision)
    update({
      presenceVisibility: result.visibility,
      notice:
        visibility === "invisible" ? "已隐身，好友将看到你离线" : "已设为在线",
    });
}
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
let settingsWrites = Promise.resolve();
function persistSettings(
  transform: (current: DesktopSettings) => DesktopSettings,
) {
  const work = settingsWrites
    .catch(() => {})
    .then(async () => {
      const settings = transform(state().settings);
      if (window.desktop) await window.desktop.saveSettings(settings);
      else
        localStorage.setItem("cinegather.settings", JSON.stringify(settings));
      update({ settings });
      return settings;
    });
  settingsWrites = work.then(
    () => {},
    () => {},
  );
  return work;
}
let deviceWork: Promise<MediaDeviceInfo[]> | undefined;
let rescanDevices = false,
  restartInput = false;
export function refreshAudioDevices(
  recoverInput = false,
): Promise<MediaDeviceInfo[]> {
  rescanDevices = true;
  restartInput ||= recoverInput;
  if (deviceWork) return deviceWork;
  const work = (async () => {
    while (rescanDevices) {
      rescanDevices = false;
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      const before = state().settings;
      const devices = await navigator.mediaDevices.enumerateDevices();
      let granted = false;
      try {
        granted =
          (
            await navigator.permissions.query({
              name: "microphone" as PermissionName,
            })
          ).state === "granted";
      } catch {
        /* Device labels remain a fallback signal on older browsers. */
      }
      if (
        before.inputDevice !== state().settings.inputDevice ||
        before.outputDevice !== state().settings.outputDevice
      ) {
        rescanDevices = true;
        continue;
      }
      update({ audioDevices: devices });
      const checked = reconcileAudioDevices(before, devices, granted);
      const forceInput = restartInput;
      restartInput = false;
      if (!checked.missing.length && !forceInput) continue;
      const saved = checked.missing.length
        ? await persistSettings((current) => ({
            ...current,
            ...(current.inputDevice === before.inputDevice
              ? { inputDevice: checked.inputDevice }
              : {}),
            ...(current.outputDevice === before.outputDevice
              ? { outputDevice: checked.outputDevice }
              : {}),
          }))
        : state().settings;
      const inputChanged =
        checked.missing.includes("audioinput") &&
        saved.inputDevice === checked.inputDevice;
      const outputChanged =
        checked.missing.includes("audiooutput") &&
        saved.outputDevice === checked.outputDevice;
      const results = await Promise.allSettled([
        inputChanged || forceInput
          ? media.devices(saved.inputDevice, undefined)
          : undefined,
        outputChanged
          ? media.devices(undefined, saved.outputDevice)
          : undefined,
      ]);
      if (results.some((r) => r.status === "rejected")) {
        update({
          warningTitle: "音频设备不可用",
          warning:
            "已改用系统默认设备。请连接麦克风或耳机，并在设置中检查设备权限。",
        });
      } else if (inputChanged || outputChanged) {
        update({
          notice: `${inputChanged && outputChanged ? "麦克风和输出设备" : inputChanged ? "麦克风" : "输出设备"}已断开，已切换为系统默认`,
        });
      }
    }
    return state().audioDevices;
  })();
  deviceWork = work;
  void work
    .finally(() => {
      if (deviceWork === work) deviceWork = undefined;
    })
    .catch(() => {});
  return work;
}
async function recoverMissingMicrophone(error: unknown) {
  if (
    !(error instanceof Error) ||
    !["NotFoundError", "OverconstrainedError"].includes(error.name) ||
    !state().settings.inputDevice
  )
    return false;
  try {
    await persistSettings((current) => ({ ...current, inputDevice: "" }));
    await media.devices("", undefined);
    update({ notice: "原麦克风不可用，已切换为系统默认麦克风" });
  } catch {
    update({
      warningTitle: "麦克风不可用",
      warning: "已改为系统默认麦克风。请连接麦克风，并在设置中检查设备权限。",
    });
  }
  return true;
}
export const chat = new RoomChat(
  async (roomId, after) =>
    unwrap(
      await api.GET("/api/v1/rooms/{roomId}/messages", {
        params: { path: { roomId }, query: { after } },
      }),
    ),
  (chat) => update({ chat }),
  (message, unread) => {
    const roomId = state().chat.roomId;
    if (roomId) update({ chatNotification: { roomId, message, unread } });
  },
);
export function showRoomChat(roomId: string) {
  if (state().room?.id !== roomId) return;
  update({
    chatTab: "chat",
    chatRequest: state().chatRequest + 1,
    modal: null,
  });
}
export async function sendChatMessage(body: string) {
  const roomId = state().room?.id;
  if (!roomId) throw new Error("请先进入房间");
  const message = unwrap(
    await api.POST("/api/v1/rooms/{roomId}/messages", {
      params: { path: { roomId } },
      body: { body },
      headers: { "Idempotency-Key": crypto.randomUUID() },
    }),
  );
  chat.receive(roomId, message);
}
const roomCuePlayer = new RoomCuePlayer(
  { enter: enterCue, leave: leaveCue },
  () => state().settings,
);
const roomCues = new RoomPresenceCues((cue) => roomCuePlayer.play(cue));
export const media = new MediaSession(
  (summary) => {
    roomCues.observe(summary);
    if (summary.state === "connected" && state().media.state !== "connected")
      void chat.sync();
    const fallback = summary.microphoneNoise?.reason;
    if (fallback && !state().media.microphoneNoise?.reason)
      update({ notice: "高质量降噪暂不可用，已切换兼容降噪" });
    update({ media: summary });
    const local = summary.participants.find((p) => p.local);
    if (
      (summary.state === "disconnected" ||
        local?.microphoneAllowed === false) &&
      state().accompaniment.status !== "idle"
    )
      void accompaniment.stop().catch(report);
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
  (command) => {
    if (command.action === "stop-accompaniment") {
      void accompaniment.stop().catch(report);
      update({ warning: "房主已关闭你的伴奏" });
    } else if (command.action === "mute-microphone") {
      pttHolds.clear();
      update({ warning: "房主已关闭你的麦克风" });
    } else {
      void shareSession
        .revoke(command.leaseId)
        .then((stopped) => {
          if (stopped) update({ warning: "房主已停止你的共享" });
        })
        .catch(report);
    }
  },
  () => {
    void refreshAudioDevices(true).catch(report);
  },
  (roomId, message) => chat.receive(roomId, message),
);
export const diagnostics = new DiagnosticRecorder(media, state, async () =>
  unwrap(
    await api.GET("/api/v1/diagnostics", { signal: AbortSignal.timeout(8000) }),
  ),
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
const accompanimentAudio = new ProcessAudio((message) => {
  void accompaniment.stop().catch(report);
  report(new Error(message));
});
export const accompaniment = new Accompaniment({
  capture: async (source, volume) => {
    const bridge = window.desktop?.accompaniment;
    const app = state();
    if (!bridge)
      throw new Error("当前浏览器不支持指定应用伴奏，请使用桌面客户端");
    if (app.roomState !== "connected" || !app.room)
      throw new Error("请先进入房间");
    if (
      app.room.memberPermissions?.find((p) => p.userId === app.user?.id)
        ?.microphoneAllowed === false
    )
      throw new Error("房主已禁止你在此房间开麦，无法发布伴奏");
    const requestId = crypto.randomUUID();
    const result = await accompanimentAudio.start(
      {
        start: () => bridge.start(source, requestId),
        stop: () => bridge.stop(requestId),
        acknowledge: bridge.acknowledge,
        onData: bridge.onData,
        onError: bridge.onError,
      },
      volume,
    );
    return result.track;
  },
  stopCapture: () => accompanimentAudio.stop(),
  publish: (track) => media.publishAccompaniment(track),
  unpublish: (track) => media.unpublishAccompaniment(track),
  volume: (value) => accompanimentAudio.volume(value),
  changed: (status, source) =>
    update({ accompaniment: { ...state().accompaniment, status, source } }),
});
export function accompanimentVolume(volume: number) {
  const level = Number.isFinite(volume)
    ? Math.max(0, Math.min(100, volume))
    : 0;
  accompaniment.volume(level / 100);
  update({ accompaniment: { ...state().accompaniment, volume: level } });
}
const processAudio = new ProcessAudio((message) => {
  report(new Error(message));
  void shareSession.stop().catch(report);
});
export const shareSession: ShareCoordinator = new ShareCoordinator({
  acquire: async (preempt) =>
    unwrap(
      await api.POST(
        preempt
          ? "/api/v1/rooms/{roomId}/share-lease/preempt"
          : "/api/v1/rooms/{roomId}/share-lease",
        {
          params: { path: { roomId: state().room!.id } },
        },
      ),
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
      if (
        ![401, 403, 404].includes(result.response.status) &&
        result.error?.code !== "LEASE_LOST"
      )
        unwrap(result);
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
      (state().shareState !== "selectingSource" && !state().switchingSource)
    )
      return false;
    if (!sources.length)
      throw new Error("未找到共享来源，请检查系统屏幕录制权限后重试");
    update({ sources, modal: "source" });
    return new Promise<boolean>((resolve) => {
      selectResolve = resolve;
    });
  },
  replace: async () => {
    try {
      if (window.desktop?.nativeCapture)
        await window.desktop.switchNativeSource!();
      else {
        if (capabilities().sourcePicker) {
          const selected = await media.selectBrowserShare(
            state().settings.quality,
            state().systemAudio,
            true,
          );
          if (
            !selected ||
            !state().switchingSource ||
            shareSession.state !== "active"
          )
            throw new Error("共享已取消");
        }
        await media.replaceBrowserShare();
      }
    } finally {
      await window.desktop?.cancelCapture();
    }
  },
  publish: async (lease) => {
    await accompaniment.stop();
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
    if (state().modal === "source") await chooseSource();
    update({ audioCompatibility: false });
    await processAudio.stop();
    await window.desktop?.stopNativeCapture?.();
    await media.stopShare();
    await window.desktop?.cancelCapture();
  },
  changed: (shareState, revision) => {
    update({
      shareState,
      shareRevision: revision,
      ...(shareState === "acquiringLease" ? { shareRecovery: undefined } : {}),
    });
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
    await refreshAudioDevices().catch(report);
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
      if (!(await recoverMissingMicrophone(error))) report(error);
    }
  },
  disconnect: () => {
    pttHolds.clear();
    return Promise.all([accompaniment.stop(), media.disconnect()]).then(
      () => {},
    );
  },
  stopShare,
  changed: (roomState, room, revision) => {
    if (roomState === "idle" || roomState === "leaving") {
      chat.leave();
      update({ chatTab: "members", chatNotification: undefined });
    }
    if (roomState === "idle") update({ shareRecovery: undefined });
    if (roomState === "connected") {
      roomCues.enter(state().media);
      if (room && state().user) void chat.enter(room.id, state().user!.id);
    } else if (roomState === "leaving") roomCues.leave();
    else if (roomState === "failed") roomCues.reset();
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
  const stopDiagnostics = diagnostics.start();
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
  await refreshAudioDevices().catch(report);
  const deviceChanged = () => {
    void refreshAudioDevices(media.inputRecoveryNeeded).catch(report);
  };
  navigator.mediaDevices?.addEventListener("devicechange", deviceChanged);
  if (sessionToken)
    await run(async () => {
      update({ user: unwrap(await api.GET("/api/v1/me")) });
      await syncPresence();
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
    if (action === "stop-accompaniment") {
      void accompaniment.stop().catch(report);
      return;
    }
    if (action === "capture-ended") {
      void stopShare()
        .then(() => {
          if (state().room)
            update({
              shareRecovery: value || "共享采集已中断，请重新选择来源",
            });
        })
        .catch(report);
      return;
    }
    if (state().requiredUpdate && action !== "stop-share") return;
    if (action === "invite" && value) {
      receiveInvitation(value);
      void window.desktop?.takeInvitation();
    }
    if (action === "device-audio-fallback")
      update({
        audioCompatibility: true,
        warningTitle: deviceAudioTitle,
        warning: deviceAudioDescription,
      });
    if (action === "stop-share") void stopShare();
    if (action === "toggle-mute") void toggleMicrophone();
    if (action === "ptt-press") void ptt(true, "global");
    if (action === "ptt-release") void ptt(false, "global");
  });
  const timer = setInterval(() => void syncRooms(), 2500);
  void checkClientPolicy();
  const policyTimer = setInterval(
    () => void checkClientPolicy(),
    60 * 60 * 1000,
  );
  const nativeUpdates = await window.desktop?.updates
    ?.status()
    .catch(() => undefined);
  const eventUrl = new URL("/api/v1/client-events", baseUrl);
  eventUrl.searchParams.set(
    "platform",
    window.desktop?.platform === "win32"
      ? "win32"
      : window.desktop?.platform === "darwin"
        ? "darwin"
        : "web",
  );
  const stopPolicyEvents =
    !window.desktop ||
    nativeUpdates?.mode === "disabled" ||
    baseUrl !== clientUpdateOrigin
      ? watchUpdateEvents(eventUrl.href, (event, raw) => {
          if (event !== "policy") return;
          const policy = clientPolicySchema.parse(JSON.parse(raw));
          const platform = window.desktop?.platform;
          requireClientUpdate(
            policy.minimumVersions[
              platform === "win32" || platform === "darwin" ? platform : "web"
            ],
            policy.reason,
          );
        })
      : Object.assign(() => {}, { reconnect: () => {} });
  const onlinePolicy = () => {
    stopPolicyEvents.reconnect();
    void window.desktop?.updates?.reconnect?.().catch(() => {});
  };
  window.addEventListener("online", onlinePolicy);
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
  const presenceTimer = setInterval(() => void syncPresence(), 15000);
  const chatTimer = setInterval(() => {
    if (state().room) void chat.sync();
  }, 30_000);
  const focus = () => {
    void syncPresence();
    void syncFriends();
    if (state().room) void chat.sync();
  };
  const chatVisibility = () => {
    if (document.visibilityState === "visible" && state().room)
      void chat.sync();
  };
  document.addEventListener("visibilitychange", chatVisibility);
  window.addEventListener("focus", focus);
  return () => {
    navigator.mediaDevices?.removeEventListener("devicechange", deviceChanged);
    clearInterval(timer);
    clearInterval(policyTimer);
    stopDiagnostics();
    stopPolicyEvents();
    window.removeEventListener("online", onlinePolicy);
    clearInterval(friendsTimer);
    clearInterval(presenceTimer);
    clearInterval(chatTimer);
    document.removeEventListener("visibilitychange", chatVisibility);
    chat.leave();
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
  update({ presenceVisibility: undefined });
  await syncPresence(true);
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
export async function updateMemberPermissions(
  roomId: string,
  userId: string,
  input: { microphoneAllowed?: boolean; sharingAllowed?: boolean },
) {
  const identity = sessionToken;
  const revision = state().roomRevision;
  const saved = unwrap(
    await api.POST("/api/v1/rooms/{roomId}/members/{userId}/permissions", {
      params: { path: { roomId, userId } },
      body: input,
    }),
  );
  if (
    identity !== sessionToken ||
    state().room?.id !== roomId ||
    state().roomRevision !== revision
  )
    return;
  update({ room: saved, notice: "成员权限已更新" });
}
export async function transferRoomOwner(roomId: string, userId: string) {
  const identity = sessionToken;
  const revision = state().roomRevision;
  const saved = unwrap(
    await api.POST("/api/v1/rooms/{roomId}/members/{userId}/owner", {
      params: { path: { roomId, userId } },
    }),
  );
  if (
    identity !== sessionToken ||
    state().room?.id !== roomId ||
    state().roomRevision !== revision
  )
    return;
  update({ room: saved, notice: "房主已转移" });
  await refreshRooms();
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
    if (!(await recoverMissingMicrophone(error))) report(error);
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
  const switching = state().switchingSource;
  const revision = state().shareRevision;
  try {
    const selected = await media.selectBrowserShare(
      state().settings.quality,
      state().systemAudio,
      state().switchingSource,
    );
    if (
      revision !== state().shareRevision ||
      (state().shareState !== "selectingSource" && !state().switchingSource)
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
      update({
        notice: switching
          ? "未切换来源，继续共享原画面"
          : "未开始共享，可重新选择或检查 Chrome 的共享权限",
      });
    else report(error);
  }
}
export async function switchShareSource() {
  if (state().switchingSource || shareSession.state !== "active") return;
  update({ switchingSource: true });
  try {
    await shareSession.switchSource();
  } finally {
    media.cancelBrowserSelection();
    await window.desktop?.cancelCapture();
    update({ switchingSource: false });
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
export async function saveSettings(settings: DesktopSettings, close = true) {
  settings = platformSettings(settings, capabilities().desktop);
  if (settings.roomSounds === false) roomCuePlayer.stop();
  const held = pttHolds.size > 0;
  pttHolds.clear();
  if (
    (held || (settings.pushToTalk && !state().settings.pushToTalk)) &&
    ["connected", "reconnecting"].includes(state().roomState)
  )
    await media.microphone(false);
  const devices = await navigator.mediaDevices?.enumerateDevices();
  if (devices) {
    update({ audioDevices: devices });
    const checked = reconcileAudioDevices(settings, devices);
    settings = {
      ...settings,
      inputDevice: checked.inputDevice,
      outputDevice: checked.outputDevice,
    };
  }
  settings = await persistSettings(() => settings);
  await media.devices(settings.inputDevice, settings.outputDevice);
  await media.noiseReduction(settings.noiseReduction);
  update({
    settings,
    notice:
      settings.noiseReduction === "enhanced" &&
      state().media.microphoneNoise?.reason
        ? "设置已保存，增强降噪暂不可用，已使用基础降噪"
        : "设置已保存",
    ...(close ? { modal: null } : {}),
  });
}
export async function createInvite() {
  const room = state().room;
  if (!room) return;
  await refreshFriends();
  if (room.role !== "owner") {
    update({ invite: undefined, inviteId: undefined, modal: "invite" });
    return;
  }
  const roomId = room.id;
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
export async function dismissRoomInvitation(id: string) {
  unwrap(
    await api.DELETE("/api/v1/room-invitations/{inviteId}", {
      params: { path: { inviteId: id } },
    }),
  );
  await refreshFriends();
}
export async function openRoomInvitationInbox() {
  if (state().modal === "source") await chooseSource();
  update({ modal: "room-invitations" });
}
export async function acceptRoomInvitation(invitation: RoomInvitation) {
  await roomSession.enter(invitation.roomId, invitation.token);
  await refreshRooms();
  await refreshFriends();
  if (
    state().room?.id === invitation.roomId &&
    state().roomState === "connected"
  )
    update({ modal: null });
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
