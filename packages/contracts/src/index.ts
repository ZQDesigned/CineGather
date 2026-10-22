import { z } from "zod";

export const guestInput = z.strictObject({
  displayName: z.string().trim().min(1).max(32),
});
export const roomInput = z.strictObject({
  name: z.string().trim().min(1).max(64),
  maxMembers: z.number().int().min(2).max(10).default(5),
});
export const joinInput = z.strictObject({
  inviteToken: z.string().min(32).max(128).optional(),
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
export const userSchema = z.object({ id: z.uuid(), displayName: z.string() });
export const roomSchema = z.object({
  id: z.uuid(),
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
  audioApplication?: string;
};
export interface DesktopSettings {
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
