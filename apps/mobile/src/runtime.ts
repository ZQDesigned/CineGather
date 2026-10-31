import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import {
  SnackbarQueue,
  MobileApi,
  MobilePulse,
  RoomSnapshotSync,
  MobileSession,
  RoomCoordinator,
  RoomChat,
  MobileShare,
  mobileShareCapability,
  parseInvitation,
  type ChatSnapshot,
} from "@cinegather/client-core";
import {
  type RoomInfo,
  type RoomState,
  type ShareState,
  type Quality,
  qualityPresets,
  leaseSchema,
  nativePublicationSchema,
  userSchema,
  sessionSchema,
  friendsSchema,
  joinSchema,
  roomSchema,
  registrationPolicySchema,
  type ChatMessage,
  type AnnouncementInbox,
  announcementInboxSchema,
} from "@cinegather/contracts";
import { ApiError } from "@cinegather/api-client";
import { CriticalTimers } from "livekit-client";
import { screenShare } from "./platform/screen-share";
import { NativeMedia } from "./media/NativeMedia";
import { appendDiagnostic } from "./platform/journal";
import { localNotice } from "./platform/notifications";
import { roomAudio } from "./platform/room-audio";
import {
  MobileUpdateService,
  mobileUpdateIdentity,
  mobileCodeVersion,
} from "./platform/updates";

export interface Notice {
  id: number;
  title: string;
  body: string;
  time: number;
}
export interface RuntimeSnapshot {
  roomState: RoomState;
  shareState: ShareState;
  room?: RoomInfo;
  rooms: RoomInfo[];
  friends: ReturnType<typeof friendsSchema.parse>;
  chat: ChatSnapshot;
  notices: Notice[];
  dnd: boolean;
  announcements: AnnouncementInbox["items"];
  popup?: AnnouncementInbox["items"][number];
  registration: boolean;
  busy: boolean;
  visibility: "online" | "invisible";
}
export class MobileRuntime {
  readonly feedback = new SnackbarQueue();
  readonly origin: string;
  readonly version = mobileCodeVersion;
  readonly updates: MobileUpdateService;
  readonly session: MobileSession;
  readonly api: MobileApi;
  readonly media: NativeMedia;
  readonly coordinator: RoomCoordinator;
  readonly chat: RoomChat;
  readonly sharing: MobileShare;
  private shareAudio = true;
  private shareQuality: Quality = "cinema";
  private shareContexts = new Map<
    string,
    { roomId: string; token: string; captureId: string }
  >();
  private listeners = new Set<() => void>();
  private generation = 0;
  private roomRevision = 0;
  private readonly roomSync: RoomSnapshotSync;
  private poll?: ReturnType<typeof setTimeout>;
  private refreshing?: Promise<void>;
  private started = false;
  private traces: unknown[] = [];
  private diagnosticFailures = 0;
  private knownRequests = new Set<string>();
  private knownInvites = new Set<string>();
  private noticeId = 0;
  private preferenceRevision = 0;
  private preferenceSave = Promise.resolve();
  private knownAnnouncements = new Set<string>();
  private current: RuntimeSnapshot = {
    roomState: "idle",
    shareState: "idle",
    rooms: [],
    friends: { items: [], roomInvitations: [], roomJoinRequests: [] },
    chat: { items: [], unread: 0, loading: false, failed: false },
    notices: [],
    announcements: [],
    dnd: false,
    registration: false,
    busy: false,
    visibility: "online",
  };
  constructor(origin?: string) {
    this.origin = (
      origin ??
      Constants.expoConfig?.extra?.apiOrigin ??
      "https://cgplat.zqdesigned.city"
    ).replace(/\/$/, "");
    const key = `cinegather.session.${encodeURIComponent(this.origin).replace(/%/g, "_")}`;
    this.session = new MobileSession({
      storage: {
        read: async () => (await SecureStore.getItemAsync(key)) ?? undefined,
        write: async (token) => {
          await SecureStore.setItemAsync(key, token, {
            keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
          });
        },
        clear: async () => {
          await SecureStore.deleteItemAsync(key);
        },
      },
      profile: async (token) =>
        userSchema.parse(
          await this.api.call("me", (c) => c.GET("/api/v1/me"), {
            token,
            invalidate: false,
          }),
        ),
      revoke: async (token) => {
        await this.api.call("logout", (c) => c.DELETE("/api/v1/session"), {
          token,
          invalidate: false,
        });
      },
    });
    this.api = new MobileApi({
      origin: this.origin,
      platform: Platform.OS === "ios" ? "ios" : "android",
      version: this.version,
      mobile: mobileUpdateIdentity,
      updateRequired: (kind) => this.updates?.require(kind),
      getToken: () => this.session.getToken(),
      expire: async (token) => this.session.invalidate(token),
      trace: (e) => {
        this.traces.push({ time: Date.now(), ...e });
        this.traces = this.traces.slice(-10000);
      },
    });
    this.roomSync = new RoomSnapshotSync({
      scope: () => {
        const session = this.session.getToken(),
          room = this.current.room;
        return session && room && this.current.roomState === "connected"
          ? { session, roomId: room.id, revision: this.roomRevision }
          : undefined;
      },
      read: async (roomId, token) =>
        roomSchema.parse(
          await this.api.call(
            "room",
            (c) =>
              c.GET("/api/v1/rooms/{roomId}", { params: { path: { roomId } } }),
            { token },
          ),
        ),
      apply: (room) => {
        const promoted =
          this.current.room?.ownerUserId !== room.ownerUserId &&
          room.ownerUserId === this.session.snapshot().user?.id;
        this.patch({
          room,
          rooms: this.current.rooms.map((r) => (r.id === room.id ? room : r)),
        });
        this.applyPermissions(room);
        if (promoted) this.notice("你已成为房主", "现在可以管理房间和成员");
      },
    });
    this.media = new NativeMedia({
      stopShare: (leaseId) => {
        void this.sharing.revoke(leaseId).catch((e) => this.fail(e));
      },
      roomChanged: () => {
        void this.refreshRoom().catch((e) => this.fail(e));
      },
      message: (message) => {
        const room = this.current.room;
        if (room) this.chat.receive(room.id, message);
      },
      disconnected: (reason) => {
        void this.handleRoomDisconnect(reason).catch((e) => this.fail(e));
      },
      error: (e) => this.fail(e),
      foregroundService: async (microphone) => {
        await roomAudio.start(
          this.current.room?.name ?? "映聚房间",
          microphone,
        );
      },
      stopService: async () => {
        await roomAudio.stop();
      },
    });
    const context = (scope: string) => {
      const value = this.shareContexts.get(scope);
      if (!value) throw new Error("共享会话已失效");
      return value;
    };
    this.sharing = new MobileShare({
      timers: {
        setInterval: (fn, delay) => CriticalTimers.setInterval(fn, delay),
        clearInterval: (id) => CriticalTimers.clearInterval(id),
      },
      scope: () =>
        this.current.roomState === "connected" &&
        this.current.room &&
        this.session.getToken()
          ? `${this.current.room.id}:${this.roomRevision}:${this.generation}`
          : undefined,
      allowed: () => this.canShare(),
      acquire: async (scope) => {
        const value = {
          roomId: this.current.room!.id,
          token: this.session.getToken()!,
          captureId: this.sharing.captureId!,
        };
        this.shareContexts.set(scope, value);
        try {
          return leaseSchema.parse(
            await this.api.call(
              "share-acquire",
              (c) =>
                c.POST("/api/v1/rooms/{roomId}/share-lease", {
                  params: { path: { roomId: value.roomId } },
                }),
              { token: value.token },
            ),
          );
        } catch (error) {
          this.shareContexts.delete(scope);
          throw error;
        }
      },
      renew: async (scope, lease) => {
        const value = context(scope);
        const renewed = leaseSchema.parse(
          await this.api.call(
            "share-renew",
            (c) =>
              c.POST("/api/v1/rooms/{roomId}/share-lease/renew", {
                params: { path: { roomId: value.roomId } },
                body: { leaseId: lease.leaseId, revision: lease.revision },
              }),
            { token: value.token },
          ),
        );
        if (this.sharing.captureId === value.captureId)
          await screenShare.renew(
            value.captureId,
            Date.parse(renewed.expiresAt),
          );
        return renewed;
      },
      release: async (scope, lease) => {
        const value = context(scope);
        try {
          await this.api.call(
            "share-release",
            (c) =>
              c.DELETE("/api/v1/rooms/{roomId}/share-lease", {
                params: { path: { roomId: value.roomId } },
                body: { leaseId: lease.leaseId, revision: lease.revision },
              }),
            { token: value.token, invalidate: false },
          );
        } catch (e) {
          if (
            !(e instanceof ApiError && [401, 403, 404, 409].includes(e.status))
          )
            throw e;
        } finally {
          this.shareContexts.delete(scope);
        }
      },
      publish: async (scope, lease, id) => {
        const value = context(scope);
        const publication = nativePublicationSchema.parse(
          await this.api.call(
            "share-native",
            (c) =>
              c.POST("/api/v1/rooms/{roomId}/share-lease/native", {
                params: { path: { roomId: value.roomId } },
                body: { leaseId: lease.leaseId, revision: lease.revision },
              }),
            { token: value.token },
          ),
        );
        if (
          this.sharing.captureId !== id ||
          this.current.shareState !== "publishing" ||
          this.session.getToken() !== value.token
        )
          throw new Error("共享已取消");
        if (AppState.currentState !== "active")
          throw new Error("请返回映聚后重新发起共享");
        const preset = qualityPresets[this.shareQuality];
        await screenShare.start({
          id,
          url: publication.url,
          token: publication.token,
          audio: this.shareAudio,
          expiresAt: Date.parse(publication.expiresAt),
          width: preset.width,
          height: preset.height,
          fps: preset.frameRate,
          bitrate: preset.maxBitrate,
        });
      },
      stop: (id) => screenShare.stop(id),
      changed: (shareState) => this.patch({ shareState }),
      error: (e) => this.fail(e),
    });
    screenShare.listen((event) => {
      try {
        appendDiagnostic({
          time: Date.now(),
          event: "screen-share-status",
          ...event,
        });
      } catch {
        this.diagnosticFailures++;
      }
      if (
        ["stopped", "failed"].includes(event.state) &&
        event.id === this.sharing.captureId
      ) {
        if (event.state === "failed" && event.reason)
          this.fail(new Error(event.reason));
        void this.sharing.ended(event.id).catch((e) => this.fail(e));
      }
    });
    this.chat = new RoomChat(
      async (roomId, after) =>
        this.api.call("messages", (c) =>
          c.GET("/api/v1/rooms/{roomId}/messages", {
            params: { path: { roomId }, query: { after } },
          }),
        ),
      (chat) => this.patch({ chat }),
      (message) => this.notice(message.displayName, message.body),
    );
    this.coordinator = new RoomCoordinator({
      join: async (roomId, inviteToken, password) =>
        joinSchema.parse(
          await this.api.call("join", (c) =>
            c.POST("/api/v1/rooms/{roomId}/join", {
              params: { path: { roomId } },
              body: { inviteToken, password },
            }),
          ),
        ),
      leave: async (roomId) => {
        await this.api.call("leave", (c) =>
          c.POST("/api/v1/rooms/{roomId}/leave", {
            params: { path: { roomId } },
          }),
        );
      },
      connect: async (url, token) => {
        if (this.updates.updater.snapshot().required)
          throw new Error("请先完成应用更新");
        await this.media.connect(url, token);
      },
      disconnect: () => this.media.disconnect(),
      stopShare: () => this.sharing.stop(),
      changed: (roomState, room, revision) => {
        this.roomRevision = revision;
        const previous = this.current.room?.id;
        this.patch({ roomState, room });
        if (roomState === "connected" && room) {
          const id = this.session.snapshot().user?.id;
          if (id && previous !== room.id) void this.chat.enter(room.id, id);
          this.applyPermissions(room);
          void this.refreshRoom().catch((e) => this.fail(e));
          void roomAudio
            .start(room.name, this.media.snapshot().microphone)
            .catch((e) => this.fail(e));
        } else if (!room) this.chat.leave();
      },
      error: (e) => this.fail(e),
    });
    this.updates = new MobileUpdateService(
      () => this.coordinator.leave(true, true),
      this.origin,
    );
  }
  snapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(next: Partial<RuntimeSnapshot>) {
    this.current = { ...this.current, ...next };
    for (const fn of this.listeners) fn();
  }
  fail(error: unknown) {
    if (error instanceof ApiError && error.staleSession) return;
    this.feedback.show({
      tone: "error",
      text:
        error instanceof Error
          ? /[\u4e00-\u9fff]/.test(error.message)
            ? error.message.slice(0, 500)
            : "操作未完成，请检查网络后重试"
          : "操作未完成，请稍后重试",
    });
  }
  clearError() {
    this.feedback.dismiss();
  }
  notice(title: string, body: string, options: { snackbar?: boolean } = {}) {
    const notice = { id: ++this.noticeId, title, body, time: Date.now() };
    this.patch({ notices: [notice, ...this.current.notices].slice(0, 200) });
    if (!this.current.dnd) {
      if (options.snackbar !== false)
        this.feedback.show({ text: `${title}\n${body}` });
      void localNotice(title, body).catch(() => {});
    }
  }
  setVisibility(visibility: "online" | "invisible") {
    this.patch({ visibility });
  }
  setDnd(dnd: boolean) {
    ++this.preferenceRevision;
    this.patch({ dnd });
    this.preferenceSave = this.preferenceSave
      .catch(() => {})
      .then(() =>
        SecureStore.setItemAsync("cinegather.preference.dnd", dnd ? "1" : "0"),
      )
      .catch(() => {
        this.fail(new Error("免打扰设置未能保存，请重试"));
      });
  }
  start() {
    if (this.started) return;
    this.started = true;
    this.feedback.setForeground(AppState.currentState === "active");
    this.updates.start();
    const preferenceRevision = this.preferenceRevision;
    void SecureStore.getItemAsync("cinegather.preference.dnd")
      .then((value) => {
        if (preferenceRevision === this.preferenceRevision)
          this.patch({ dnd: value === "1" });
      })
      .catch(() => {});
    let lastBackgroundRefresh = 0;
    const pulse = new MobilePulse({
      interval: () => (this.current.room ? 5000 : 30000),
      run: async () => {
        appendDiagnostic({
          time: Date.now(),
          version: this.version,
          platform: Platform.OS,
          media: await this.media.diagnostics(),
          capture: await screenShare.diagnostics(),
          updates: {
            identity: mobileUpdateIdentity,
            ...this.updates.updater.snapshot(),
          },
        });
      },
      error: () => {
        this.diagnosticFailures++;
      },
    });
    pulse.start();
    const roomPulse = new MobilePulse({
      interval: () => (AppState.currentState === "active" ? 2000 : 30000),
      run: () => this.refreshRoom(),
      error: (e) => this.fail(e),
    });
    roomPulse.start();
    roomAudio.addListener("tick", () => {
      pulse.pulse();
      roomPulse.pulse();
      if (
        AppState.currentState !== "active" &&
        Date.now() - lastBackgroundRefresh > 30000
      ) {
        lastBackgroundRefresh = Date.now();
        void this.refresh();
      }
    });
    let lastSessionError: string | undefined;
    this.session.subscribe(() => {
      const session = this.session.snapshot();
      if (session.status === "signed-out") this.feedback.clear();
      const sessionError = session.error;
      if (sessionError && sessionError !== lastSessionError)
        this.fail(new Error(sessionError));
      lastSessionError = sessionError;
      const token = this.session.getToken();
      if (!token) {
        ++this.generation;
        this.knownRequests.clear();
        this.knownInvites.clear();
        this.knownAnnouncements.clear();
        this.media.resetMemberGains();
        if (this.current.roomState !== "idle")
          void this.coordinator.leave().catch((e) => this.fail(e));
        this.patch({
          rooms: [],
          friends: { items: [], roomInvitations: [], roomJoinRequests: [] },
          notices: [],
          announcements: [],
          popup: undefined,
        });
      } else void this.refresh();
    });
    const app = AppState.addEventListener("change", (state) => {
      this.feedback.setForeground(state === "active");
      this.media.setForeground(state === "active");
      pulse.pulse();
      this.chat.setView(false, true);
      if (state === "active") {
        void this.refreshRoom().catch((e) => this.fail(e));
        void this.refresh();
      }
    });
    roomAudio.addListener("leave", () => {
      void this.coordinator.leave().catch((e) => this.fail(e));
    });
    roomAudio.addListener("interruption", ({ interrupted }) =>
      this.media.interrupt(interrupted),
    );
    roomAudio.addListener("routeLost", () => {
      this.media.safetyMute();
      this.notice("音频设备已断开", "麦克风已暂停，请确认设备后手动开启");
    });
    this.session.subscribe(() => {
      if (!this.session.getToken()) this.media.interrupt(false);
    });
    void app; // Owned for the lifetime of this application runtime.
    const tick = async () => {
      await this.refresh();
      this.poll = setTimeout(
        tick,
        AppState.currentState === "active" ? 15000 : 30000,
      );
    };
    void this.api
      .call("registration", (c) => c.GET("/api/v1/registration"), {
        token: null,
      })
      .then((v) =>
        this.patch({ registration: registrationPolicySchema.parse(v).enabled }),
      )
      .catch(() => {});
    void this.session.restore();
    this.poll = setTimeout(tick, 15000);
  }
  async authenticate(
    mode: "login" | "register",
    username: string,
    password: string,
    displayName: string,
  ) {
    const body = {
      username: username.trim(),
      password,
      displayName: displayName.trim(),
    };
    return this.session.authenticate(async () =>
      sessionSchema.parse(
        mode === "register"
          ? await this.api.call(
              "register",
              (c) => c.POST("/api/v1/accounts/register", { body }),
              { token: null },
            )
          : await this.api.call(
              "login",
              (c) =>
                c.POST("/api/v1/accounts/login", {
                  body: { username: body.username, password },
                }),
              { token: null },
            ),
      ),
    );
  }
  async refresh() {
    if (this.updates.updater.snapshot().required) return;
    if (this.refreshing) return this.refreshing;
    const token = this.session.getToken(),
      generation = this.generation;
    if (!token) return;
    const current = () =>
      this.session.getToken() === token &&
      this.generation === generation &&
      !this.updates.updater.snapshot().required;
    this.refreshing = (async () => {
      const results = await Promise.allSettled([
        this.api.call("rooms", (c) => c.GET("/api/v1/rooms")),
        this.api.call("friends", (c) => c.GET("/api/v1/friends")),
        this.api.call("presence", (c) => c.POST("/api/v1/presence/heartbeat")),
        this.api.call("presence-settings", (c) => c.GET("/api/v1/presence")),
      ]);
      if (!current()) return;
      const [rooms, friends, , visibility] = results;
      if (visibility?.status === "fulfilled")
        this.patch({ visibility: visibility.value.visibility });
      if (rooms?.status === "fulfilled")
        this.patch({
          rooms: rooms.value.items.map((r) => roomSchema.parse(r)),
        });
      if (friends?.status === "fulfilled") {
        const value = friendsSchema.parse(friends.value);
        for (const request of value.items.filter(
          (f) => f.status === "pending" && f.incoming,
        )) {
          if (!this.knownRequests.has(request.userId))
            this.notice(
              "新的好友申请",
              `${request.displayName} 希望添加你为好友`,
            );
          this.knownRequests.add(request.userId);
        }
        for (const request of value.roomJoinRequests.filter(
          (r) => r.incoming && r.status === "pending",
        )) {
          if (!this.knownRequests.has(request.id))
            this.notice("入房申请", `${request.displayName} 申请加入你的房间`);
          this.knownRequests.add(request.id);
        }
        for (const invitation of value.roomInvitations) {
          if (!this.knownInvites.has(invitation.id)) {
            this.knownInvites.add(invitation.id);
            if (
              invitation.requestApproved &&
              !this.current.room &&
              this.current.roomState === "idle"
            )
              void this.join(invitation.roomId, undefined, invitation.token)
                .then((joined) =>
                  joined ? this.dismissInvite(invitation.id) : undefined,
                )
                .catch((e) => this.fail(e));
            else
              this.notice(
                "房间邀请",
                `${invitation.senderName} 邀请你加入 ${invitation.roomName}`,
              );
          }
        }
        this.patch({ friends: value });
        for (const friend of value.items)
          if (friend.volume !== undefined)
            this.media.setMemberGain(friend.userId, friend.volume / 100, true);
      }
      await this.refreshAnnouncements();
      await this.refreshRoom();
      if (this.current.room) await this.chat.sync();
    })()
      .catch((e) => this.fail(e))
      .finally(() => {
        this.refreshing = undefined;
      });
    return this.refreshing;
  }
  private async handleRoomDisconnect(reason: string) {
    const room = this.current.room,
      token = this.session.getToken(),
      revision = this.roomRevision;
    if (!room) return;
    const removed = reason === "你已被房主移出房间";
    // The room read locks the same server transaction as takeover/moderation.
    // Resolve the cause even when the control packet lost the race with removal.
    const status = removed
      ? this.api
          .call(
            "room-disconnect-status",
            (c) =>
              c.GET("/api/v1/rooms/{roomId}", {
                params: { path: { roomId: room.id } },
              }),
            { token, invalidate: false },
          )
          .then(
            () => undefined,
            (error) => error,
          )
      : Promise.resolve(undefined);
    await this.coordinator.leave(!removed && !reason.includes("另一台设备"));
    const result = await status;
    if (
      this.session.getToken() !== token ||
      this.current.room ||
      this.roomRevision !== revision + 1
    )
      return;
    this.notice(
      "房间连接",
      result instanceof ApiError && result.code === "ROOM_SESSION_REPLACED"
        ? "房间已在另一台设备打开，本设备已退出房间"
        : reason,
    );
  }
  async refreshRoom() {
    const room = this.current.room;
    try {
      await this.roomSync.refresh();
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "ROOM_SESSION_REPLACED" &&
        this.current.room?.id === room?.id
      ) {
        this.notice(
          "已在其他设备加入房间",
          "房间已在另一台设备打开，本设备已退出房间",
        );
        await this.coordinator.leave(false);
        return;
      }
      throw error;
    }
  }
  canShare() {
    const user = this.session.snapshot().user;
    return (
      !!user?.screenShareEnabled &&
      this.current.roomState === "connected" &&
      this.current.room?.memberPermissions?.find((m) => m.userId === user.id)
        ?.sharingAllowed !== false
    );
  }
  async startSharing(audio: boolean, quality: Quality) {
    if (!screenShare.available)
      throw new Error("当前安装包尚未包含屏幕共享模块，请安装新版测试客户端");
    if (AppState.currentState !== "active")
      throw new Error("请返回映聚后发起共享");
    const capability = mobileShareCapability(
      Platform.OS,
      parseInt(String(Platform.Version)),
    );
    this.shareAudio = audio && capability.audio;
    this.shareQuality = quality;
    if (this.shareAudio && Platform.OS === "android") {
      const { PermissionsAndroid } = await import("react-native");
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      if (result !== PermissionsAndroid.RESULTS.GRANTED)
        throw new Error("共享声音需要录音权限，也可关闭共享声音后重试");
    }
    await this.sharing.start();
  }
  private applyPermissions(room: RoomInfo) {
    const allowed =
      room.memberPermissions?.find(
        (m) => m.userId === this.session.snapshot().user?.id,
      )?.microphoneAllowed !== false;
    if (!this.canShare() && !["idle", "failed"].includes(this.sharing.state))
      void this.sharing.stop().catch((e) => this.fail(e));
    if (this.media.snapshot().microphoneAllowed !== allowed)
      this.media.setAllowed(allowed);
  }
  async inviteFriend(userId: string, roomId: string) {
    if (
      this.current.room?.id !== roomId ||
      this.current.roomState !== "connected"
    )
      throw new Error("房间已变更，请重新打开邀请");
    if (
      !this.current.friends.items.some(
        (f) => f.userId === userId && f.status === "accepted",
      )
    )
      throw new Error("该用户已不在你的好友列表中");
    await this.api.call("invite-friend", (c) =>
      c.POST("/api/v1/rooms/{roomId}/friend-invitations", {
        params: { path: { roomId } },
        body: { userId },
      }),
    );
  }
  async join(input: string, password?: string, inviteToken?: string) {
    if (this.updates.updater.snapshot().required)
      throw new Error("请先完成应用更新");
    const parsed = parseInvitation(input);
    await this.coordinator.enter(
      parsed.roomId,
      inviteToken ?? parsed.inviteToken,
      password,
    );
    return this.current.roomState === "connected";
  }
  async create(name: string, maxMembers: number, password?: string) {
    const room = await this.api.call("create-room", (c) =>
      c.POST("/api/v1/rooms", {
        body: {
          name,
          maxMembers,
          access: password ? "password" : "normal",
          password: password || undefined,
        },
      }),
    );
    await this.join(room.id, password);
    await this.refresh();
  }
  async sendMessage(body: string) {
    const room = this.current.room;
    if (!room) return;
    const message = await this.api.call("message", (c) =>
      c.POST("/api/v1/rooms/{roomId}/messages", {
        params: { path: { roomId: room.id } },
        body: { body },
      }),
    );
    this.chat.receive(room.id, message as ChatMessage);
  }
  async refreshAnnouncements() {
    const token = this.session.getToken();
    if (!token) return;
    const inbox = announcementInboxSchema.parse(
      await this.api.call("announcements", (c) =>
        c.GET("/api/v1/announcements/inbox"),
      ),
    );
    if (token !== this.session.getToken()) return;
    this.patch({ announcements: inbox.items });
    const fresh = inbox.items.filter(
      (a) => !a.read && !this.knownAnnouncements.has(a.id),
    );
    for (const item of fresh) {
      this.knownAnnouncements.add(item.id);
      this.notice(item.title, item.body, {
        snackbar: !(item.popup && item.state === "active"),
      });
    }
    const popup = fresh.find((a) => a.popup && a.state === "active");
    if (popup) this.patch({ popup });
  }
  async readAnnouncement(announcementId: string) {
    if (this.current.popup?.id === announcementId)
      this.patch({ popup: undefined });
    await this.api.call("read-announcement", (c) =>
      c.POST("/api/v1/announcements/{announcementId}/read", {
        params: { path: { announcementId } },
      }),
    );
    await this.refreshAnnouncements();
  }
  async dismissInvite(inviteId: string) {
    await this.api.call("dismiss-invite", (c) =>
      c.DELETE("/api/v1/room-invitations/{inviteId}", {
        params: { path: { inviteId } },
      }),
    );
    await this.refresh();
  }
  async signOut() {
    await this.coordinator.leave();
    await this.session.signOut();
  }
  diagnostics() {
    return {
      platform: Platform.OS,
      version: this.version,
      origin: this.origin,
      time: new Date().toISOString(),
      roomState: this.current.roomState,
      media: {
        ...this.media.snapshot(),
        video: this.media.snapshot().video ? "native-video-track" : undefined,
      },
      requests: this.traces,
      diagnosticFailures: this.diagnosticFailures,
      limitations: [
        "不包含麦克风录音、聊天正文或登录凭据",
        "物理设备的麦克风、蓝牙与锁屏稳定性需真机验证",
      ],
    };
  }
}
export const runtime = new MobileRuntime();
