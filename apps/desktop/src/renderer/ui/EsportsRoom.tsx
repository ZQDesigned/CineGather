import { Avatar, Empty, Select, Switch, Tag, Spin, Slider, Form } from "antd";
import { useEffect, useRef, useState, type ReactNode } from "react";
import styled from "@emotion/styled";
import {
  Trophy,
  Users,
  Headphones,
  Mic,
  MicOff,
  MonitorUp,
  MonitorOff,
  Maximize,
  LogOut,
  Settings2,
  UserPlus,
  Copy,
  Volume2,
  Search,
} from "lucide-react";
import {
  type EsportsSeat,
  type EsportsConfiguration,
  type CoachVoiceMode,
  defaultEsportsConfiguration,
  esportsCapacityTotal,
  esportsTeamName,
  esportsSeatChoices,
  isTeamSeat,
  qualityLabel,
} from "@cinegather/contracts";
import { unwrap } from "@cinegather/api-client";
import { useApp, update } from "../store";
import * as actions from "../controller";
import { Button, Input } from "./Controls";
import { Member } from "./Member";
import { AudioQuickControl } from "./AudioQuickControl";
import { MicrophoneEffectControl } from "./MicrophoneEffect";
import { ModalShell } from "./Modal";
import { useCapturePreview } from "./useCapturePreview";
import { WatchProfileControl } from "./WatchProfile";
const Surface = styled.div`
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  .esports-heading,
  .esports-title,
  .esports-actions {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .esports-heading {
    justify-content: space-between;
    flex-shrink: 0;
  }
  .esports-title h1 {
    font-size: 24px;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .esports-code {
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .esports-title .ant-tag {
    margin: 0;
  }
  .esports-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 260px;
    gap: 18px;
    min-height: 0;
    flex: 1;
  }
  .esports-view {
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .esports-stage {
    position: relative;
    flex: 1;
    min-height: 200px;
    background: #0a0c12;
    border: 1px solid var(--line);
    border-radius: 16px;
    overflow: hidden;
  }
  .esports-stage:fullscreen {
    border: 0;
    border-radius: 0;
  }
  .esports-video {
    position: absolute;
    inset: 0;
  }
  .esports-video video,
  .esports-preview {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #090a0e;
  }
  .esports-stage .esports-preview {
    position: absolute;
    inset: 0;
  }
  .esports-stage-note {
    position: absolute;
    left: 16px;
    top: 14px;
    display: flex;
    gap: 8px;
    align-items: center;
    background: #141620b8;
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 12px;
    z-index: 1;
  }
  .esports-stage-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 14px;
    text-align: center;
    padding: 24px;
    color: var(--muted);
  }
  .esports-stage-empty h2 {
    margin: 0;
    color: var(--text);
    font-size: 20px;
  }
  .esports-fullscreen {
    position: absolute !important;
    right: 12px;
    bottom: 12px;
    width: 38px;
    height: 38px;
    z-index: 2;
    background: #1e202aab !important;
  }
  .esports-warm {
    position: absolute;
    right: 16px;
    top: 16px;
    padding: 6px 10px;
    background: #242031d9;
    border-radius: 8px;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 2;
  }
  .esports-teams {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    flex-shrink: 1;
    max-height: 38%;
    overflow-y: auto;
    min-height: 90px;
  }
  .esports-team {
    border: 1px solid var(--line);
    background: var(--panel);
    padding: 12px;
    border-radius: 12px;
    min-width: 0;
  }
  .esports-team-title {
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    color: var(--muted);
  }
  .esports-players {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 7px;
  }
  .esports-player {
    appearance: none;
    background: #14161f;
    border: 1px solid #ffffff0a;
    min-width: 0;
    border-radius: 10px;
    padding: 10px 3px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    color: var(--text);
    font-size: 11px;
    cursor: pointer;
  }
  .esports-player:disabled,
  .esports-player[aria-disabled="true"] {
    cursor: default;
    opacity: 0.5;
  }
  .esports-player.selected {
    border-color: #b39af2;
    background: #b39af218;
  }
  .esports-player.warming {
    border-color: #b39af280;
  }
  .esports-player span {
    max-width: 100%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .esports-player small {
    color: var(--muted);
    font-size: 10px;
  }
  .esports-player.selected small {
    color: #bca8f3;
  }
  .esports-empty-seat {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff24;
    border: 1px dashed #ffffff0c;
    border-radius: 10px;
    min-height: 78px;
  }
  .esports-aside {
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .esports-audio {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 14px;
    min-width: 0;
  }
  .esports-audio-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
    margin-bottom: 12px;
  }
  .esports-audio-title strong {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .esports-audio-title small,
  .esports-summary {
    color: var(--muted);
    font-size: 11px;
  }
  .esports-audio .member {
    padding: 8px 0;
  }
  .esports-audio .member-avatar {
    width: 32px;
    height: 32px;
  }
  .esports-audio .member-name {
    font-size: 12px;
  }
  .esports-audio .member-detail {
    font-size: 11px;
  }
  .esports-audio .ant-switch {
    flex-shrink: 0;
  }
  .esports-auto {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: var(--muted);
    gap: 8px;
    margin-bottom: 12px;
  }
  .esports-summary {
    padding: 0 6px;
    display: flex;
    justify-content: space-between;
    margin-top: auto;
  }
  .esports-bottom {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    flex-shrink: 0;
  }
  .esports-microphone {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .esports-microphone > button {
    min-width: 48px;
  }
  .esports-channel {
    color: var(--muted);
    font-size: 12px;
    flex: 1;
    min-width: 0;
  }
  .esports-channel strong {
    color: var(--text);
    display: block;
    margin-bottom: 4px;
    font-size: 12px;
  }
  .esports-roster {
    flex: 1;
    min-height: 150px;
    overflow-y: auto;
  }
  .esports-roster-empty {
    padding: 28px 0;
    text-align: center;
    color: var(--muted);
    font-size: 12px;
  }
  .esports-listening {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 12px;
    color: var(--muted);
    font-size: 11px;
    flex-shrink: 0;
  }
  .esports-listening .esports-auto {
    margin: 0;
  }
  .esports-audio-level {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 110px;
    flex: 1;
    max-width: 190px;
  }
  .esports-audio-level .ant-slider {
    flex: 1;
    min-width: 45px;
    margin: 5px;
  }
  .esports-role-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-shrink: 0;
    font-size: 12px;
    color: var(--muted);
  }
  @media (max-width: 1150px) {
    .esports-workspace {
      grid-template-columns: minmax(0, 1fr) 220px;
      gap: 12px;
    }
    .esports-title h1 {
      font-size: 20px;
    }
    .esports-title .ant-tag {
      display: none;
    }
    .esports-actions {
      gap: 6px;
    }
    .esports-player {
      padding: 8px 2px;
    }
    .esports-players {
      gap: 4px;
    }
    .esports-bottom {
      gap: 7px;
      padding: 10px;
    }
    .esports-channel small {
      display: none;
    }
  }
  @media (max-height: 780px) {
    gap: 12px;
    .esports-player {
      padding: 6px 2px;
    }
    .esports-empty-seat {
      min-height: 64px;
    }
    .esports-team {
      padding: 8px;
    }
    .esports-bottom {
      padding: 8px 12px;
    }
    .esports-stage {
      min-height: 170px;
    }
  }
`;
export const esportsSeatLabel = (
  seat: EsportsSeat,
  config: EsportsConfiguration = defaultEsportsConfiguration,
) =>
  isTeamSeat(seat)
    ? `${esportsTeamName(config, seat.team)}${seat.kind === "coach" ? "教练" : "选手"}`
    : seat.kind === "director"
      ? "导播"
      : "观众";
function TacticalControl() {
  const snapshot = useApp((s) => s.esports?.snapshot),
    owner = useApp((s) => s.room?.role === "owner");
  const [now, setNow] = useState(Date.now()),
    [busy, setBusy] = useState(false);
  const received = useRef<{ server?: string; offset: number }>({ offset: 0 });
  if (received.current.server !== snapshot?.serverTime)
    received.current = {
      server: snapshot?.serverTime,
      offset: snapshot?.serverTime
        ? new Date(snapshot.serverTime).getTime() - Date.now()
        : 0,
    };
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!snapshot) return null;
  const remaining = Math.max(
    0,
    Math.ceil(
      ((snapshot.tacticalPauseUntil
        ? new Date(snapshot.tacticalPauseUntil).getTime()
        : 0) -
        now -
        received.current.offset) /
        1000,
    ),
  );
  const run = (task: () => Promise<void>) => {
    setBusy(true);
    void actions.run(task).finally(() => setBusy(false));
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      {remaining > 0 && (
        <Tag color="gold">
          战术暂停 {Math.floor(remaining / 60)}:
          {String(remaining % 60).padStart(2, "0")}
        </Tag>
      )}
      {owner && (
        <>
          <Button
            size="small"
            disabled={busy}
            onClick={() => run(() => actions.esports.tacticalPause(!remaining))}
          >
            {remaining ? "结束暂停" : "战术暂停"}
          </Button>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>教练发言</span>
          <Select
            size="small"
            aria-label="教练发言权限"
            style={{ width: 130 }}
            disabled={busy}
            value={snapshot.coachVoiceMode ?? "auto"}
            onChange={(mode: CoachVoiceMode) =>
              run(() => actions.esports.coachVoice(mode))
            }
            options={[
              { value: "auto", label: "跟随战术暂停" },
              { value: "open", label: "始终允许" },
              { value: "closed", label: "始终禁止" },
            ]}
          />
        </>
      )}
      {!owner && snapshot.self.seat.kind === "coach" && (
        <span style={{ fontSize: 12, color: "var(--muted)" }}>
          {snapshot.self.microphoneAllowed
            ? "当前可向队伍发言"
            : "当前仅收听队伍"}
        </span>
      )}
    </div>
  );
}
export function EsportsRoom({ visible = true }: { visible?: boolean }) {
  const app = useApp(),
    snapshot = app.esports?.snapshot;
  const stage = useRef<HTMLDivElement>(null),
    view = useRef<HTMLDivElement>(null),
    localVideo = useRef<HTMLVideoElement>(null);
  const player = snapshot?.self.seat.kind === "player",
    sharing = [
      "acquiringLease",
      "selectingSource",
      "publishing",
      "active",
      "stopping",
    ].includes(app.shareState);
  const native = !!window.desktop?.nativeCapture && app.shareState === "active";
  const preview = useCapturePreview(
    native && visible ? `${app.room?.id}:${app.shareRevision}` : undefined,
  );
  useEffect(() => {
    actions.esports.browser.bind(view.current ?? undefined);
    return () => actions.esports.browser.bind();
  }, [player, snapshot?.roomId]);
  useEffect(() => {
    actions.esports.publisher?.setVideoElement(localVideo.current ?? undefined);
    return () => actions.esports.publisher?.setVideoElement(undefined);
  }, [player, app.shareState]);
  useEffect(() => {
    void actions.esports.setViewActive(visible).catch(actions.report);
  }, [visible]);
  if (!snapshot)
    return (
      <Surface className="room-page" data-testid="esports-room">
        <Spin style={{ margin: "auto" }} description="正在连接赛事房" />
      </Surface>
    );
  const configuration = snapshot.configuration ?? defaultEsportsConfiguration;
  const seat = snapshot.self.seat,
    watch = snapshot.watch,
    watching = app.esports?.watching;
  const watched = snapshot.publications.find((p) => p.id === watching),
    watchedPlayer = snapshot.members.find((m) => m.userId === watched?.userId);
  const watchedTeam =
    watchedPlayer?.seat.kind === "player" ? watchedPlayer.seat.team : undefined;
  const member = (m: typeof snapshot.self, children?: ReactNode) => {
    const peer = app.media.participants.find((p) => p.id === m.userId) ?? {
      id: m.userId,
      name: m.displayName,
      local: m.userId === app.user?.id,
      microphone: false,
      speaking: false,
      quality: "unknown",
    };
    return (
      <Member
        key={m.userId}
        participant={peer}
        statusText={
          !m.online
            ? "离线"
            : m.seat.kind === "coach" &&
                !m.microphoneAllowed &&
                app.room?.memberPermissions?.find((p) => p.userId === m.userId)
                  ?.microphoneAllowed !== false
              ? "仅收听队伍"
              : !(
                    (isTeamSeat(seat)
                      ? isTeamSeat(m.seat) && m.seat.team === seat.team
                      : m.seat.kind === seat.kind) ||
                    (isTeamSeat(m.seat) && m.seat.team === watch.monitorTeam)
                  )
                ? "已入席"
                : undefined
        }
        room={app.room!}
        children={children}
        volume={app.memberVolumes[m.userId] ?? 100}
        onVolumeChange={(v) => actions.setMemberVolume(m.userId, v)}
        onVolumeCommit={(v) =>
          void actions.commitMemberVolume(m.userId, v).catch(actions.report)
        }
      />
    );
  };
  return (
    <Surface className="room-page" data-testid="esports-room">
      <header className="esports-heading">
        <div className="esports-title">
          <h1 title={app.room!.name}>{app.room!.name}</h1>
          <Button
            type="text"
            size="small"
            className="esports-code"
            aria-label="复制房间号"
            onClick={() =>
              void actions
                .copyText(app.room!.code, "房间号已复制")
                .catch(actions.report)
            }
          >
            {app.room!.code}
            <Copy size={13} />
          </Button>
          <Tag icon={<Trophy size={12} />}>电竞赛事房</Tag>
        </div>
        <div className="esports-actions">
          {app.room?.role === "owner" && (
            <>
              <Button
                icon={<Settings2 size={15} />}
                onClick={() => update({ modal: "esports-invite" })}
              >
                定向邀请
              </Button>
              <Button
                aria-label="房间设置"
                icon={<Settings2 size={15} />}
                onClick={() => update({ modal: "room-settings" })}
              />
            </>
          )}
          <Button
            icon={<UserPlus size={15} />}
            onClick={() => void actions.createInvite().catch(actions.report)}
          >
            邀请好友
          </Button>
        </div>
      </header>
      <TacticalControl />
      <div className="esports-workspace">
        <section className="esports-view">
          <div className="esports-stage" ref={stage}>
            <div className="esports-stage-note">
              <Trophy size={13} />
              <span data-testid="esports-seat">
                {esportsSeatLabel(seat, configuration)}
              </span>
              {player && sharing && <Tag color="purple">你正在共享</Tag>}
              {!player && watching && <span>{watchedPlayer?.displayName}</span>}
            </div>
            {!player && <div className="esports-video" ref={view} />}
            {player && native && (
              <video
                className="esports-preview"
                ref={preview.video}
                autoPlay
                muted
                playsInline
              />
            )}
            {player && !native && (
              <video
                className="esports-preview"
                ref={localVideo}
                autoPlay
                muted
                playsInline
              />
            )}
            {player && !sharing ? (
              <div className="esports-stage-empty">
                <MonitorUp size={38} />
                <h2>准备你的比赛画面</h2>
                <span>
                  {configuration.groups.some(
                    (g) =>
                      g.id === (seat.kind === "player" ? seat.team : "") &&
                      g.coachSeats > 0,
                  )
                    ? "你的画面对本组教练、导播席和观众席可见，请注意不要展示隐私信息。"
                    : "你的画面对导播席和观众席可见，请注意不要展示隐私信息。"}
                </span>
                <Button
                  type="primary"
                  onClick={() => void actions.shareSession.start()}
                >
                  选择共享来源
                </Button>
              </div>
            ) : !player && !watching ? (
              <div className="esports-stage-empty">
                <MonitorUp size={38} />
                <h2>选择一位选手，进入比赛</h2>
                <span>点击下方正在共享的选手开始观看。</span>
              </div>
            ) : null}
            {app.esports?.warming && (
              <div className="esports-warm">
                <Spin size="small" />
                正在切换画面
              </div>
            )}
            {!player && watching && (
              <Button
                className="esports-fullscreen"
                aria-label="全屏画面"
                icon={<Maximize size={18} />}
                onClick={() =>
                  void (
                    document.fullscreenElement
                      ? document.exitFullscreen()
                      : stage.current!.requestFullscreen()
                  ).catch(actions.report)
                }
              />
            )}
          </div>
          <div className="esports-role-line">
            <span>
              {player
                ? qualityLabel(app.settings.quality)
                : watchedPlayer
                  ? `正在观看 ${watchedPlayer.displayName}`
                  : "等待选手共享"}
            </span>
            {!player && watching && (
              <Button
                size="small"
                type="text"
                icon={<MonitorOff size={13} />}
                onClick={() =>
                  void actions.esports.coordinator
                    .stopWatching()
                    .catch(actions.report)
                }
              >
                停止观看
              </Button>
            )}
            {!player && <WatchProfileControl />}
          </div>
          <div className="esports-listening">
            {!isTeamSeat(seat) && (
              <>
                <span>
                  {watchedTeam
                    ? `${esportsTeamName(configuration, watchedTeam)}语音`
                    : "选手组语音"}
                </span>
                <Button
                  size="small"
                  disabled={!watching}
                  icon={<Headphones size={14} />}
                  onClick={() =>
                    void actions.esports.coordinator
                      .monitor({ enabled: !watch.monitorTeam })
                      .catch(actions.report)
                  }
                >
                  {watch.monitorTeam ? "断开收听" : "收听队伍"}
                </Button>
                <label className="esports-auto">
                  自动收听
                  <Switch
                    size="small"
                    checked={watch.autoMonitor}
                    onChange={(autoMonitor) =>
                      void actions.esports.coordinator
                        .monitor({ autoMonitor })
                        .catch(actions.report)
                    }
                  />
                </label>
              </>
            )}
            <label className="esports-audio-level">
              <Volume2 size={14} />
              语音
              <Slider
                aria-label="赛事房语音音量"
                min={0}
                max={100}
                value={Math.round(app.voiceVolume * 100)}
                tooltip={{ open: false }}
                onChange={(v) => {
                  update({ voiceVolume: v / 100 });
                  actions.esports.browser.voiceVolume(v / 100);
                }}
              />
            </label>
            {!player && (
              <label className="esports-audio-level">
                <Volume2 size={14} />
                共享
                <Slider
                  aria-label="赛事房共享音量"
                  min={0}
                  max={100}
                  value={Math.round(app.screenVolume * 100)}
                  tooltip={{ open: false }}
                  onChange={(v) => {
                    update({ screenVolume: v / 100 });
                    actions.esports.browser.screenVolume(v / 100);
                  }}
                />
              </label>
            )}
          </div>
          <div className="esports-teams">
            {configuration.groups.map((group) => {
              const team = group.id;
              const players = snapshot.members.filter(
                (m) => m.seat.kind === "player" && m.seat.team === team,
              );
              return (
                <div className="esports-team" key={team}>
                  <div className="esports-team-title">
                    <strong>{group.name}选手</strong>
                    <span>
                      {players.length} / {group.playerSeats}
                    </span>
                  </div>
                  <div
                    className="esports-players"
                    style={{
                      gridTemplateColumns: `repeat(${group.playerSeats}, minmax(0, 1fr))`,
                    }}
                  >
                    {Array.from({ length: group.playerSeats }, (_, i) => {
                      const m = players[i];
                      if (!m)
                        return (
                          <div className="esports-empty-seat" key={i}>
                            <Users size={18} />
                          </div>
                        );
                      const p = snapshot.publications.find(
                        (p) => p.userId === m.userId,
                      );
                      return member(
                        m,
                        player ||
                          (seat.kind === "coach" && seat.team !== team) ? (
                          <div
                            className="esports-player"
                            key={m.userId}
                            tabIndex={0}
                            aria-label={`${m.displayName}的成员操作`}
                          >
                            <Avatar size={28}>{m.displayName[0]}</Avatar>
                            <span>{m.displayName}</span>
                            <small>
                              {m.online ? (p ? "正在共享" : "已入席") : "离线"}
                            </small>
                          </div>
                        ) : (
                          <button
                            key={m.userId}
                            data-testid="esports-watch-choice"
                            className={`esports-player ${!!p && watching === p.id ? "selected" : ""} ${!!p && app.esports?.warming === p.id ? "warming" : ""}`}
                            aria-disabled={!p || !m.online}
                            aria-label={`观看 ${m.displayName}`}
                            onClick={() => {
                              if (p && m.online)
                                void actions.esports.coordinator
                                  .select(p.id)
                                  .catch(actions.report);
                            }}
                          >
                            <Avatar size={28}>{m.displayName[0]}</Avatar>
                            <span>{m.displayName}</span>
                            <small>
                              {!m.online
                                ? "离线"
                                : !!p && watching === p.id
                                  ? "正在观看"
                                  : p
                                    ? "共享中"
                                    : "未共享"}
                            </small>
                          </button>
                        ),
                      );
                    })}
                  </div>
                  {group.coachSeats > 0 && (
                    <>
                      <div
                        className="esports-team-title"
                        style={{ marginTop: 12 }}
                      >
                        <strong>教练席</strong>
                        <span>
                          {
                            snapshot.members.filter(
                              (m) =>
                                m.seat.kind === "coach" && m.seat.team === team,
                            ).length
                          }{" "}
                          / {group.coachSeats}
                        </span>
                      </div>
                      <div
                        style={{ display: "flex", gap: 8, flexWrap: "wrap" }}
                      >
                        {snapshot.members
                          .filter(
                            (m) =>
                              m.seat.kind === "coach" && m.seat.team === team,
                          )
                          .map((m) => member(m))}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <footer className="esports-bottom">
            <div className="esports-microphone">
              <Button
                type="text"
                disabled={
                  !snapshot.self.microphoneAllowed ||
                  app.roomState !== "connected"
                }
                aria-label={
                  app.media.participants.find((p) => p.local)?.microphone
                    ? "关闭麦克风"
                    : "开启麦克风"
                }
                onClick={() => void actions.toggleMicrophone()}
                icon={
                  app.media.participants.find((p) => p.local)?.microphone ? (
                    <Mic size={22} />
                  ) : (
                    <MicOff size={22} />
                  )
                }
              />
              <AudioQuickControl disabled={app.roomState !== "connected"} />
            </div>
            <MicrophoneEffectControl disabled={app.roomState !== "connected"} />
            <div className="esports-channel">
              <strong>
                {isTeamSeat(seat)
                  ? `${esportsTeamName(configuration, seat.team)}语音`
                  : seat.kind === "director"
                    ? "导播席语音"
                    : "观众席语音"}
              </strong>
            </div>
            {player && (
              <Button
                aria-label="共享屏幕"
                type={sharing ? "default" : "primary"}
                icon={<MonitorUp size={16} />}
                disabled={!snapshot.self.sharingAllowed && !sharing}
                onClick={() =>
                  void (sharing
                    ? actions.stopShare()
                    : actions.shareSession.start())
                }
              >
                {sharing ? "停止共享" : "共享屏幕"}
              </Button>
            )}
            <Button
              danger
              icon={<LogOut size={16} />}
              onClick={() =>
                void actions.roomSession.leave().catch(actions.report)
              }
            >
              离开房间
            </Button>
          </footer>
        </section>
        <aside className="esports-aside">
          {app.media.audioBlocked && (
            <Button
              type="primary"
              onClick={() =>
                void actions.startRoomAudio().catch(actions.report)
              }
            >
              启用房间声音
            </Button>
          )}
          {(["director", "audience"] as const).map((kind) => {
            const occupants = snapshot.members.filter(
              (m) => m.seat.kind === kind,
            );
            return (
              <section className="esports-audio esports-roster" key={kind}>
                <div className="esports-audio-title">
                  <strong>
                    {kind === "director" ? (
                      <Headphones size={16} />
                    ) : (
                      <Users size={16} />
                    )}
                    {kind === "director" ? "导播席" : "观众席"}
                  </strong>
                  <small>{occupants.length} / 5</small>
                </div>
                {occupants.map((m) => member(m))}
                {!occupants.length && (
                  <div className="esports-roster-empty">暂无成员</div>
                )}
              </section>
            );
          })}
          <div className="esports-summary">
            <span>
              导播{" "}
              {
                snapshot.members.filter((m) => m.seat.kind === "director")
                  .length
              }
              /5
            </span>
            <span>
              观众{" "}
              {
                snapshot.members.filter((m) => m.seat.kind === "audience")
                  .length
              }
              /5
            </span>
            <span>
              {snapshot.members.length}/{esportsCapacityTotal(configuration)}
            </span>
          </div>
        </aside>
      </div>
    </Surface>
  );
}
export function EsportsSeatInvite() {
  const configuration =
    useApp((s) => s.esports?.snapshot?.configuration) ??
    defaultEsportsConfiguration;
  const choices = esportsSeatChoices(configuration);
  const seatOptions = choices.map((c) => ({ value: c.key, label: c.label }));
  const [username, setUsername] = useState(""),
    [target, setTarget] = useState<{
      userId: string;
      displayName: string;
    } | null>(),
    [seat, setSeat] = useState("audience"),
    [busy, setBusy] = useState(false);
  return (
    <ModalShell
      title="定向邀请席位"
      footer={
        <>
          <Button onClick={() => update({ modal: null })}>取消</Button>
          <Button
            type="primary"
            disabled={!target || busy}
            loading={busy}
            onClick={() => {
              setBusy(true);
              void actions
                .run(async () => {
                  unwrap(
                    await actions.api.POST(
                      "/api/v1/rooms/{roomId}/friend-invitations",
                      {
                        params: { path: { roomId: actions.esports.roomId! } },
                        body: {
                          userId: target!.userId,
                          seat: choices.find((c) => c.key === seat)!.seat,
                        },
                      },
                    ),
                  );
                  update({ notice: "席位邀请已发送", modal: null });
                })
                .finally(() => setBusy(false));
            }}
          >
            发送邀请
          </Button>
        </>
      }
    >
      <Form
        layout="vertical"
        onFinish={() => {
          setBusy(true);
          void actions.api
            .GET("/api/v1/friends/search", {
              params: { query: { username: username.trim() } },
            })
            .then((result) => setTarget(unwrap(result).user))
            .catch(actions.report)
            .finally(() => setBusy(false));
        }}
      >
        <Form.Item label="用户名">
          <div style={{ display: "flex", gap: 8 }}>
            <Input
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setTarget(undefined);
              }}
              placeholder="输入完整用户名"
            />
            <Button
              htmlType="submit"
              loading={busy}
              icon={<Search size={15} />}
            >
              搜索
            </Button>
          </div>
        </Form.Item>
        <Form.Item label="目标席位">
          <Select value={seat} options={seatOptions} onChange={setSeat} />
        </Form.Item>
      </Form>
      {target === null ? (
        <Empty description="没有找到该账号" />
      ) : (
        target && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar>{target.displayName[0]}</Avatar>
            {target.displayName}
          </div>
        )
      )}
    </ModalShell>
  );
}
