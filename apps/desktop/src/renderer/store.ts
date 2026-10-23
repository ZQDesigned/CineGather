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
export type Modal =
  | "create"
  | "join"
  | "settings"
  | "invite"
  | "source"
  | "friends"
  | "diagnostics"
  | "bans"
  | null;
export const defaults: DesktopSettings = {
  minimizeToTray: true,
  pushToTalk: false,
  pttShortcut: "CommandOrControl+Shift+Space",
  muteShortcut: "CommandOrControl+Shift+M",
  quality: "cinema",
  inputDevice: "",
  outputDevice: "",
};
interface State {
  user?: User;
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
