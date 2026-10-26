import { create } from "zustand";
import type {
  User,
  RoomInfo,
  RoomState,
  ShareState,
  DesktopSettings,
  CaptureSource,
} from "@cinegather/contracts";
import type { MediaSummary } from "@cinegather/media-core";
import { defaultSettings } from "../shared/settings";
import type { Friend } from "./friends";
export type Modal =
  | "room-settings"
  | "create"
  | "join"
  | "settings"
  | "download"
  | "invite"
  | "source"
  | "friends"
  | "diagnostics"
  | "bans"
  | "share-unavailable"
  | "updates"
  | null;
export const defaults = defaultSettings;
interface State {
  accompaniment: {
    status: "idle" | "starting" | "active";
    source?: string;
    volume: number;
  };
  requiredUpdate?: { minimumVersion: string; reason: string };
  user?: User;
  friends: Friend[];
  registrationEnabled?: boolean;
  room?: RoomInfo;
  roomRevision: number;
  shareRevision: number;
  roomState: RoomState;
  shareState: ShareState;
  media: MediaSummary;
  rooms: RoomInfo[];
  modal: Modal;
  busy: boolean;
  error?: string;
  notice?: string;
  warning?: string;
  warningTitle?: string;
  cinema: boolean;
  settings: DesktopSettings;
  memberVolumes: Record<string, number>;
  voiceVolume: number;
  screenVolume: number;
  systemAudio: boolean;
  switchingSource: boolean;
  shareRecovery?: string;
  audioDevices: MediaDeviceInfo[];
  audioCompatibility: boolean;
  sources: CaptureSource[];
  invite?: string;
  inviteId?: string;
  joinValue: string;
}
export const useApp = create<State>(() => ({
  accompaniment: { status: "idle", volume: 20 },
  roomRevision: 0,
  shareRevision: 0,
  roomState: "idle",
  shareState: "idle",
  media: {
    revision: 0,
    state: "disconnected",
    participants: [],
    audioBlocked: false,
    watching: false,
    systemAudio: false,
  },
  rooms: [],
  friends: [],
  modal: null,
  busy: false,
  cinema: false,
  settings: defaults,
  memberVolumes: {},
  voiceVolume: 1,
  screenVolume: 1,
  systemAudio: false,
  switchingSource: false,
  audioDevices: [],
  audioCompatibility: false,
  sources: [],
  joinValue: "",
}));
export const state = useApp.getState;
export const update = useApp.setState;
