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
export const registrationPolicyInput = z.strictObject({
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
export const roomInput = z
  .strictObject({
    name: z.string().trim().min(1).max(64),
    maxMembers: z.number().int().min(2).max(10).default(5),
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
export const moderationInput = z.strictObject({
  ban: z.boolean().default(false),
});
export const userSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  username: z.string().nullable().optional(),
  isSuperAdmin: z.boolean().optional(),
  roles: z.array(accountRoleSchema).optional(),
  permissions: z.array(adminPermissionSchema).optional(),
});
export const roomSchema = z.object({
  id: z.uuid(),
  code: z.string().regex(/^[A-F0-9]{8}$/),
  access: z.enum(["normal", "password"]),
  ownerUserId: z.uuid(),
  name: z.string(),
  maxMembers: z.number(),
  role: z.enum(["owner", "member"]),
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
export const messagesSchema = z.object({
  items: z.array(messageSchema),
  nextCursor: z.string().nullable(),
});
export const friendsSchema = z.object({
  items: z.array(
    z.object({
      userId: z.uuid(),
      displayName: z.string(),
      status: z.enum(["pending", "accepted"]),
      incoming: z.boolean(),
    }),
  ),
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
};
export type CaptureThumbnail = { id: string; thumbnail: string };
export type CaptureSelection = {
  sourceId: string;
  systemAudio: boolean;
};
export type NoiseReduction = "enhanced" | "basic" | "off";
export interface DesktopSettings {
  noiseReduction: NoiseReduction;
  minimizeToTray: boolean;
  pushToTalk: boolean;
  pttShortcut: string;
  muteShortcut: string;
  quality: Quality;
  inputDevice: string;
  outputDevice: string;
}
export interface DesktopBridge {
  platform: string;
  updates?: DesktopUpdates;
  nativeCapture?: boolean;
  startNativeCapture?(request: NativeCaptureRequest): Promise<void>;
  renewNativeCapture?(lease: ShareLease): Promise<ShareLease>;
  stopNativeCapture?(): Promise<void>;
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
        | "stop-share"
        | "invite",
      value?: string,
    ) => void,
  ): () => void;
  setSharing(active: boolean): Promise<void>;
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
