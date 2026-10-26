export * from "./admin";
export * from "./permissions";
export * from "./client-policy";
import { accountRoleSchema, adminPermissionSchema } from "./permissions";
import { z } from "zod";

export const usernameInput = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9_]+$/, "用户名仅支持字母、数字和下划线")
  .transform((value) => value.toLowerCase());
export const accountPassword = z
  .string()
  .min(10, "密码至少需要 10 个字符")
  .max(128);
export const registerInput = z.strictObject({
  username: usernameInput,
  displayName: z.string().trim().min(1).max(32),
  password: accountPassword,
});
export const registrationPolicySchema = z.object({ enabled: z.boolean() });
export const adminRegistrationPolicySchema = registrationPolicySchema.extend({
  screenShareDefaultEnabled: z.boolean(),
});
export const registrationPolicyInput = z.strictObject({
  screenShareDefaultEnabled: z.boolean().optional(),
  enabled: z.boolean(),
  reason: z.string().trim().min(1).max(500),
});
export const loginInput = z.strictObject({
  username: usernameInput,
  password: z.string().min(1).max(128),
});
export const passwordInput = z.strictObject({
  currentPassword: z.string().min(1).max(128),
  password: accountPassword,
});
export const MAX_ROOM_MEMBERS = 10;
export const roomSettingsInput = z
  .strictObject({
    name: z.string().trim().min(1).max(64).optional(),
    maxMembers: z.number().int().min(2).max(MAX_ROOM_MEMBERS).optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.maxMembers !== undefined,
    "请修改房间名称或人数上限",
  );
export const roomInput = z
  .strictObject({
    name: z.string().trim().min(1).max(64),
    maxMembers: z.number().int().min(2).max(MAX_ROOM_MEMBERS).default(5),
    access: z.enum(["normal", "password"]).default("normal"),
    password: z.string().min(4).max(64).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.access === "password" && !value.password?.trim())
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "请设置 4–64 位房间密码",
      });
    if (value.access === "normal" && value.password !== undefined)
      ctx.addIssue({
        code: "custom",
        path: ["password"],
        message: "普通房不需要密码",
      });
  });
export const joinInput = z.strictObject({
  inviteToken: z.string().min(32).max(128).optional(),
  password: z.string().min(1).max(64).optional(),
});
export const inviteInput = z.strictObject({
  expiresInHours: z.number().int().min(1).max(168).default(24),
  maxUses: z.number().int().min(1).max(100).default(10),
});
export const leaseInput = z.strictObject({
  leaseId: z.uuid().toLowerCase(),
  revision: z.number().int().positive(),
});
export const messageInput = z.strictObject({
  body: z.string().trim().min(1).max(2000),
});
export const friendInput = z.strictObject({ userId: z.uuid().toLowerCase() });
export const friendSearchSchema = z.object({
  user: z
    .object({ userId: z.uuid(), username: z.string(), displayName: z.string() })
    .nullable(),
});
export const moderationInput = z.strictObject({
  ban: z.boolean().default(false),
});
export const userSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  username: z.string().nullable().optional(),
  isSuperAdmin: z.boolean().optional(),
  screenShareEnabled: z.boolean().optional(),
  roles: z.array(accountRoleSchema).optional(),
  permissions: z.array(adminPermissionSchema).optional(),
});
export const memberPermissionSchema = z.object({
  userId: z.uuid(),
  microphoneAllowed: z.boolean(),
  sharingAllowed: z.boolean(),
});
export const memberPermissionsInput = z
  .object({
    microphoneAllowed: z.boolean().optional(),
    sharingAllowed: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "请选择需要修改的权限");
export const roomSchema = z.object({
  id: z.uuid(),
  code: z.string().regex(/^[A-F0-9]{8}$/),
  access: z.enum(["normal", "password"]),
  ownerUserId: z.uuid(),
  name: z.string(),
  maxMembers: z.number(),
  role: z.enum(["owner", "member"]),
  memberPermissions: z.array(memberPermissionSchema).optional(),
});
export const leaseSchema = z.object({
  leaseId: z.uuid(),
  holderUserId: z.uuid(),
  expiresAt: z.string(),
  revision: z.number(),
});
export const sessionSchema = z.object({
  user: userSchema,
  sessionToken: z.string(),
  expiresAt: z.string(),
});
export const joinSchema = z.object({
  room: roomSchema,
  token: z.string(),
  url: z.string(),
});
export const inviteSchema = z.object({
  id: z.uuid(),
  token: z.string(),
  expiresAt: z.string(),
  maxUses: z.number(),
});
export const messageSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  displayName: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof messageSchema>;
export const ROOM_CHAT_TOPIC = "cinegather-chat-v1";
export const roomChatEventSchema = z.strictObject({
  roomId: z.uuid(),
  message: messageSchema.extend({
    body: z.string().max(2000),
    displayName: z.string().max(100),
    createdAt: z.iso.datetime({ offset: true }),
  }),
});
export const messagesSchema = z.object({
  items: z.array(messageSchema),
  nextCursor: z.string().nullable(),
});
export const roomInvitationSchema = z.object({
  id: z.uuid(),
  roomId: z.uuid(),
  roomName: z.string(),
  senderId: z.uuid(),
  senderName: z.string(),
  token: z.string().min(32).max(128),
  expiresAt: z.iso.datetime({ offset: true }),
});
export type RoomInvitation = z.infer<typeof roomInvitationSchema>;
export const friendRoomInviteSentSchema = z.object({
  id: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
});
export const friendsSchema = z.object({
  roomInvitations: z.array(roomInvitationSchema).default([]),
  items: z.array(
    z.object({
      userId: z.uuid(),
      displayName: z.string(),
      status: z.enum(["pending", "accepted"]),
      incoming: z.boolean(),
      online: z.boolean().default(false),
    }),
  ),
});
export const presenceSchema = z.strictObject({
  visibility: z.enum(["online", "invisible"]),
});
export const okSchema = z.object({ ok: z.literal(true) });
export const qualityPresets = {
  saver: {
    label: "省流",
    width: 1280,
    height: 720,
    frameRate: 30,
    maxBitrate: 2_000_000,
  },
  cinema: {
    label: "影院",
    width: 1920,
    height: 1080,
    frameRate: 30,
    maxBitrate: 5_000_000,
  },
  game: {
    label: "游戏",
    width: 1920,
    height: 1080,
    frameRate: 60,
    maxBitrate: 8_000_000,
  },
} as const;
export type Quality = keyof typeof qualityPresets;
export function qualityLabel(quality: Quality): string {
  const preset = qualityPresets[quality];
  return `${preset.label}（${preset.height}p/${preset.frameRate}fps）`;
}
export type User = z.infer<typeof userSchema>;
export type RoomInfo = z.infer<typeof roomSchema>;
export type ShareLease = z.infer<typeof leaseSchema>;
export type RoomState =
  | "idle"
  | "authenticating"
  | "joining"
  | "connected"
  | "reconnecting"
  | "leaving"
  | "failed";
export type ShareState =
  | "idle"
  | "acquiringLease"
  | "selectingSource"
  | "publishing"
  | "active"
  | "stopping"
  | "failed";
export type CaptureSource = {
  id: string;
  name: string;
  thumbnail: string;
  kind: "screen" | "window";
  application?: string;
  applicationId?: string;
  audioIsolationSupported?: boolean;
};
export type CaptureThumbnail = { id: string; thumbnail: string };
export interface NativePreviewOffer {
  id: string;
  sdp: string;
}
export interface NativePreviewBridge {
  start(id: string): Promise<NativePreviewOffer | null>;
  answer(id: string, sdp: string): Promise<boolean>;
  stop(id: string): Promise<void>;
  foreground(): Promise<boolean>;
  onForeground(callback: (active: boolean) => void): () => void;
}
export type CaptureSelection = {
  sourceId: string;
  systemAudio: boolean;
};
export type NoiseReduction = "enhanced" | "basic" | "off";
export type MemberOverlayPosition =
  | "left-top"
  | "left-center"
  | "left-bottom"
  | "right-top"
  | "right-center"
  | "right-bottom";
export interface MemberOverlayPreferences {
  position: MemberOverlayPosition;
  enabled: boolean;
  opacity: number;
}
export interface MemberOverlaySnapshot {
  roomId: string;
  roomName: string;
  members: Array<{
    id: string;
    name: string;
    local: boolean;
    owner: boolean;
    microphone: boolean;
    accompaniment?: boolean;
    speaking: boolean;
    sharing: boolean;
  }>;
}
export interface MemberOverlayView {
  backgroundOpacity: number;
  snapshot: MemberOverlaySnapshot | null;
}
export interface MemberOverlayBridge {
  state(): Promise<MemberOverlayView>;
  onChange(callback: (view: MemberOverlayView) => void): () => void;
}
export interface DesktopSettings {
  roomSounds?: boolean;
  windowsEncoder?: string;
  autoDownloadUpdates?: boolean;
  noiseReduction: NoiseReduction;
  memberOverlay?: MemberOverlayPreferences;
  minimizeToTray: boolean;
  pushToTalk: boolean;
  pttShortcut: string;
  muteShortcut: string;
  quality: Quality;
  inputDevice: string;
  outputDevice: string;
}
export interface DesktopBridge {
  accompaniment?: {
    sources(): Promise<{ id: string; name: string }[]>;
    start(sourceId: string, requestId: string): Promise<ProcessAudioStart>;
    stop(requestId: string): Promise<void>;
    acknowledge(sessionId: string, sequence: number): void;
    onData(callback: (packet: ProcessAudioPacket) => void): () => void;
    onError(callback: (sessionId: string, message: string) => void): () => void;
  };
  platform: string;
  diagnostics?: {
    record(entry: import("./diagnostics").DiagnosticRecord): Promise<void>;
    status(): Promise<import("./diagnostics").DiagnosticHistoryStatus>;
  };
  memberOverlay?: {
    publish(snapshot: MemberOverlaySnapshot | null): Promise<void>;
  };
  processAudio?: {
    start(): Promise<ProcessAudioStart>;
    stop(): Promise<void>;
    acknowledge(sessionId: string, sequence: number): void;
    onData(callback: (packet: ProcessAudioPacket) => void): () => void;
    onError(callback: (sessionId: string, message: string) => void): () => void;
  };
  updates?: DesktopUpdates;
  encoders?(): Promise<import("./native-encoders").NativeEncoderInventory>;
  nativeCapture?: boolean;
  startNativeCapture?(request: NativeCaptureRequest): Promise<void>;
  switchNativeSource?(): Promise<void>;
  renewNativeCapture?(lease: ShareLease): Promise<ShareLease>;
  stopNativeCapture?(): Promise<void>;
  nativePreview?: NativePreviewBridge;
  sources(): Promise<CaptureSource[]>;
  sourceThumbnails?(sourceIds: string[]): Promise<CaptureThumbnail[]>;
  takeInvitation(): Promise<string | undefined>;
  selectSource(selection: CaptureSelection): Promise<void>;
  cancelCapture(): Promise<void>;
  openExternal(url: string): Promise<void>;
  loadSettings(): Promise<DesktopSettings>;
  hotkeyStatus?(): Promise<{ error?: string }>;
  recordShortcut?(): Promise<string | undefined>;
  cancelShortcutRecording?(): Promise<void>;
  saveSettings(settings: DesktopSettings): Promise<void>;
  exportDiagnostics(data: Record<string, unknown>): Promise<boolean>;
  onAction(
    callback: (
      action:
        | "toggle-mute"
        | "ptt-press"
        | "ptt-release"
        | "stop-accompaniment"
        | "capture-ended"
        | "stop-share"
        | "invite"
        | "device-audio-fallback",
      value?: string,
    ) => void,
  ): () => void;
  setSharing(active: boolean): Promise<void>;
}
export interface ProcessAudioPacket {
  sessionId: string;
  sequence: number;
  data: Uint8Array;
  timestampMs: number;
}
export interface ProcessAudioStart {
  sessionId: string;
  mode: "isolated" | "device";
}

export interface UpdateStatus {
  required?: boolean;
  minimumVersion?: string;
  reason?: string;
  mode: "install" | "notify" | "disabled";
  status:
    | "disabled"
    | "idle"
    | "checking"
    | "current"
    | "available"
    | "downloading"
    | "downloaded"
    | "installing"
    | "error";
  currentVersion: string;
  latestVersion?: string;
  notes?: string;
  progress?: number;
  error?: string;
  checkedAt?: string;
  inRoom: boolean;
}
export interface DesktopUpdates {
  reconnect?(): Promise<void>;
  requireUpdate?(minimumVersion: string, reason: string): Promise<void>;
  quit?(): Promise<void>;
  status(): Promise<UpdateStatus>;
  check(): Promise<UpdateStatus>;
  download(): Promise<void>;
  install(): Promise<void>;
  openDownload(): Promise<void>;
  setInRoom(active: boolean): Promise<void>;
  onChange(callback: (status: UpdateStatus) => void): () => void;
}

const nativeIdentityPattern =
  /^cg-native:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
export function nativeIdentity(userId: string, publicationId: string) {
  return `cg-native:${userId}:${publicationId}`;
}
export function nativeOwner(identity: string): string | undefined {
  return nativeIdentityPattern.exec(identity)?.[1];
}
export const nativePublicationSchema = z.object({
  url: z.url(),
  token: z.string(),
  identity: z.string(),
  expiresAt: z.string(),
});
export type NativePublication = z.infer<typeof nativePublicationSchema>;

export interface NativeCaptureRequest {
  apiUrl: string;
  sessionToken: string;
  roomId: string;
  lease: ShareLease;
  quality: Quality;
}

// Only server-originated LiveKit packets may be interpreted as room controls.
export const ACCOMPANIMENT_TRACK = "cinegather-accompaniment-v1";
export const ROOM_CONTROL_TOPIC = "cinegather.room-control.v1";
export const roomControlSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("stop-accompaniment"), roomId: z.uuid() })
    .strict(),
  z.object({ action: z.literal("mute-microphone"), roomId: z.uuid() }).strict(),
  z
    .object({
      action: z.literal("stop-share"),
      roomId: z.uuid(),
      leaseId: z.uuid(),
    })
    .strict(),
]);
export type RoomControl = z.infer<typeof roomControlSchema>;
export const muteMicrophoneInput = z.object({}).strict();
export const stopAccompanimentInput = z.object({}).strict();
export * from "./diagnostics";

export * from "./encoder-diagnostics";

export * from "./native-encoders";
