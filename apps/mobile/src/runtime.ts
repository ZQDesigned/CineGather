import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import {
  MobileApi,
  MobilePulse,
  RoomSnapshotSync,
  MobileSession,
  RoomCoordinator,
  RoomChat,
  parseInvitation,
  type ChatSnapshot,
} from "@cinegather/client-core";
import {
  type RoomInfo,
  type RoomState,
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
import { NativeMedia } from "./media/NativeMedia";
import { appendDiagnostic } from "./platform/journal";
import { localNotice } from "./platform/notifications";
import { roomAudio } from "./platform/room-audio";

export interface Notice {
  id: number;
  title: string;
  body: string;
  time: number;
}
export interface RuntimeSnapshot {
  roomState: RoomState;
  room?: RoomInfo;
  rooms: RoomInfo[];
  friends: ReturnType<typeof friendsSchema.parse>;
  chat: ChatSnapshot;
  error?: string;
  notices: Notice[];
  dnd: boolean;
  announcements: AnnouncementInbox["items"];
  popup?: AnnouncementInbox["items"][number];
  registration: boolean;
  busy: boolean;
  visibility: "online" | "invisible";
}
export class MobileRuntime {
  readonly origin: string;
  readonly version = Constants.expoConfig?.version ?? "0.1.26";
  readonly session: MobileSession;
  readonly api: MobileApi;
  readonly media: NativeMedia;
  readonly coordinator: RoomCoordinator;
  readonly chat: RoomChat;
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
      roomChanged: () => {
        void this.refreshRoom().catch((e) => this.fail(e));
      },
      message: (message) => {
        const room = this.current.room;
        if (room) this.chat.receive(room.id, message);
      },
      disconnected: (reason) => {
        this.notice("房间连接", reason);
        void this.coordinator.leave().catch((e) => this.fail(e));
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
      connect: (url, token) => this.media.connect(url, token),
      disconnect: () => this.media.disconnect(),
      stopShare: async () => {},
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
    this.patch({
      error:
        error instanceof Error
          ? /[\u4e00-\u9fff]/.test(error.message)
            ? error.message.slice(0, 500)
            : "操作未完成，请检查网络后重试"
          : "操作未完成，请稍后重试",
    });
  }
  clearError() {
    this.patch({ error: undefined });
  }
  notice(title: string, body: string) {
    const notice = { id: ++this.noticeId, title, body, time: Date.now() };
    this.patch({ notices: [notice, ...this.current.notices].slice(0, 200) });
    if (!this.current.dnd) void localNotice(title, body).catch(() => {});
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
    this.session.subscribe(() => {
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
    if (this.refreshing) return this.refreshing;
    const token = this.session.getToken(),
      generation = this.generation;
    if (!token) return;
    const current = () =>
      this.session.getToken() === token && this.generation === generation;
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
  refreshRoom() {
    return this.roomSync.refresh();
  }
  private applyPermissions(room: RoomInfo) {
    const allowed =
      room.memberPermissions?.find(
        (m) => m.userId === this.session.snapshot().user?.id,
      )?.microphoneAllowed !== false;
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
      this.notice(item.title, item.body);
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
