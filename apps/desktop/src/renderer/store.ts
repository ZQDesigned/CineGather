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
  | "create"
  | "join"
  | "settings"
  | "invite"
  | "source"
  | "friends"
  | "diagnostics"
  | "bans"
  | "updates"
  | null;
export const defaults = defaultSettings;
interface State {
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
  voiceVolume: number;
  screenVolume: number;
  watching: boolean;
  systemAudio: boolean;
  sources: CaptureSource[];
  invite?: string;
  inviteId?: string;
  joinValue: string;
}
export const useApp = create<State>(() => ({
  roomRevision: 0,
  shareRevision: 0,
  roomState: "idle",
  shareState: "idle",
  media: {
    revision: 0,
    state: "disconnected",
    participants: [],
    audioBlocked: false,
    systemAudio: false,
  },
  rooms: [],
  friends: [],
  modal: null,
  busy: false,
  cinema: false,
  settings: defaults,
  voiceVolume: 1,
  screenVolume: 1,
  watching: true,
  systemAudio: false,
  sources: [],
  joinValue: "",
}));
export const state = useApp.getState;
export const update = useApp.setState;
