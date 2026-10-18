import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Shield,
  Copy,
  UserPlus,
  Maximize,
  Minimize,
  Clapperboard,
  MonitorUp,
  Volume2,
  ScreenShare,
  RefreshCw,
  Users,
  Headphones,
  Film,
  Mic,
  MicOff,
  Settings,
  Eye,
  EyeOff,
  LogOut,
  Signal,
  MessageCircle,
} from "lucide-react";
import { qualityPresets } from "@cinegather/contracts";
import { unwrap } from "@cinegather/api-client";
import { useApp, update } from "../store";
import * as actions from "../controller";
import { Chat } from "./Chat";
export function Room() {
  const app = useApp();
  const stage = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"members" | "chat">("members");
  const local = app.media.participants.find((p) => p.local);
  const sharing = [
    "acquiringLease",
    "selectingSource",
    "publishing",
    "active",
    "stopping",
  ].includes(app.shareState);
  const connected = app.roomState === "connected";
  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen();
  };
  return (
    <div className="room-page">
      <div className="room-heading">
        <div>
          <span className="eyebrow">
            <span className="live-dot" />
            你们的私人放映厅
          </span>
          <h1>
            {app.room!.name}
            <span className="private-badge">
              <Shield size={11} />
              私密
            </span>
          </h1>
          <button
            className="room-id"
            title="复制房间 ID"
            onClick={() =>
              void navigator.clipboard
                .writeText(app.room!.id)
                .then(() =>
                  update({ notice: "房间 ID 已复制；新朋友仍需要有效邀请" }),
                )
            }
          >
            房间 {app.room!.id.slice(0, 8).toUpperCase()}
            <Copy size={12} />
          </button>
        </div>
        <div className="heading-actions">
          {app.room!.role === "owner" && (
            <button
              className="secondary"
              onClick={() => void actions.run(actions.createInvite)}
            >
              <UserPlus size={16} />
              邀请朋友
            </button>
          )}
          <button
            className="icon-button"
            title="影院模式"
            aria-label="影院模式"
            onClick={() => update({ cinema: !app.cinema })}
          >
            {app.cinema ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
        </div>
      </div>
      <div className="room-layout">
        <div className="view-column">
          <div
            className={`stage ${app.media.sharer ? "has-video" : ""}`}
            ref={stage}
            onDoubleClick={fullscreen}
          >
            <Video />
            {!app.media.sharer && (
              <div className="stage-empty">
                <div className="stage-icon">
                  <Clapperboard size={46} strokeWidth={1.3} />
                  <span className="sparkle">✦</span>
                </div>
                <span className="eyebrow">THE SCREEN IS YOURS</span>
                <h2>好戏，等你开场</h2>
                <p>共享屏幕，与朋友一起看到同一个世界。</p>
                <button
                  className="primary"
                  disabled={!connected || sharing}
                  onClick={() => void actions.shareSession.start()}
                >
                  <MonitorUp size={17} />
                  选择屏幕开始共享
                </button>
                <span className="stage-hint">
                  屏幕 / 应用窗口 · {qualityPresets[app.settings.quality].label}
                  画质
                </span>
              </div>
            )}
            {app.media.sharer && (
              <div className="video-label">
                <span className="live-dot" />
                {app.media.sharer.local ? "你" : app.media.sharer.name}正在共享
                {app.media.systemAudio && (
                  <span>
                    <Volume2 size={13} />
                    含共享声音
                  </span>
                )}
              </div>
            )}
            <button
              className="stage-fullscreen icon-button"
              title="全屏画面"
              aria-label="全屏画面"
              onClick={fullscreen}
            >
              <Maximize size={17} />
            </button>
          </div>
          {app.shareState === "active" && (
            <div className="sharing-banner">
              <span>
                <span className="live-dot" />
                你正在共享屏幕，请留意画面中的私人信息。
              </span>
              <button onClick={() => void actions.stopShare()}>停止共享</button>
            </div>
          )}
          {app.roomState === "failed" && (
            <div className="reconnect-banner">
              <span>连接已断开</span>
              <button
                className="secondary"
                onClick={() => void actions.run(actions.retryRoom)}
              >
                <RefreshCw size={15} />
                重新连接
              </button>
            </div>
          )}
          <div className="stage-meta">
            <span>
              <ScreenShare size={15} />
              {app.media.sharer ? "实时共享" : "等待共享"}
              <span className="meta-dot">·</span>
              {qualityPresets[app.settings.quality].label}预设
            </span>
            <span>
              <Users size={14} />
              {app.media.participants.length} / {app.room!.maxMembers} 位朋友
            </span>
          </div>
          <div className="mixer-card">
            <Volume
              label="语音音量"
              icon={<Headphones size={17} />}
              value={app.voiceVolume}
              onChange={(value) => {
                update({ voiceVolume: value });
                actions.media.voiceVolume(value);
              }}
            />
            <div className="mixer-divider" />
            <Volume
              label="共享音量"
              icon={<Film size={17} />}
              value={app.screenVolume}
              onChange={(value) => {
                update({ screenVolume: value });
                actions.media.screenVolume(value);
              }}
            />
          </div>
          <div className="controls">
            <div className="control-group">
              <button
                className={`control-button ${!local?.microphone ? "muted-control" : ""}`}
                disabled={!connected}
                onClick={() => void actions.toggleMicrophone()}
                aria-label={local?.microphone ? "关闭麦克风" : "开启麦克风"}
              >
                {local?.microphone ? <Mic size={21} /> : <MicOff size={21} />}
                <span>
                  {app.settings.pushToTalk
                    ? "按住空格说话"
                    : local?.microphone
                      ? "麦克风已开启"
                      : "麦克风已关闭"}
                </span>
              </button>
              <button
                className="control-settings icon-button"
                title="音频设备设置"
                aria-label="音频设备设置"
                onClick={() => update({ modal: "settings" })}
              >
                <Settings size={15} />
              </button>
            </div>
            <div className="control-divider" />
            <button
              className={`control-button ${sharing ? "sharing-control" : ""}`}
              disabled={!connected}
              onClick={() => {
                if (sharing) void actions.stopShare();
                else void actions.shareSession.start();
              }}
            >
              <MonitorUp size={21} />
              <span>
                {sharing
                  ? app.shareState === "active"
                    ? "停止共享"
                    : "取消共享"
                  : "共享屏幕"}
              </span>
            </button>
            <button
              className="control-button"
              disabled={!app.media.sharer || app.media.sharer.local}
              onClick={() => {
                actions.media.watch(!app.watching);
                update({ watching: !app.watching });
              }}
            >
              {app.watching ? <Eye size={21} /> : <EyeOff size={21} />}
              <span>{app.watching ? "暂停观看" : "恢复观看"}</span>
            </button>
            <span className="control-spacer" />
            <button
              className="leave-button"
              onClick={() =>
                void actions.run(() => actions.roomSession.leave())
              }
            >
              <LogOut size={18} />
              <span>离开房间</span>
            </button>
          </div>
          {app.media.audioBlocked && (
            <button
              className="audio-unlock secondary"
              onClick={() => void actions.media.startAudio()}
            >
              <Volume2 size={16} />
              点击启用房间声音
            </button>
          )}
        </div>
        <aside className="room-panel">
          <div className="panel-tabs">
            <button
              className={tab === "members" ? "selected" : ""}
              onClick={() => setTab("members")}
            >
              <Users size={16} />
              成员 <span>{app.media.participants.length}</span>
            </button>
            <button
              className={tab === "chat" ? "selected" : ""}
              onClick={() => setTab("chat")}
            >
              <MessageCircle size={16} />
              聊天
            </button>
          </div>
          {tab === "members" ? (
            <>
              <div className="members-list">
                {app.media.participants.map((p) => (
                  <div
                    className={`member ${p.speaking ? "speaking" : ""}`}
                    key={p.id}
                  >
                    <div className={`avatar ${p.local ? "purple" : "amber"}`}>
                      {p.name[0]}
                    </div>
                    <div className="member-main">
                      <strong>
                        {p.name}
                        {p.local && <span>你</span>}
                        {p.id === app.room!.ownerUserId && (
                          <span className="owner-badge">房主</span>
                        )}
                      </strong>
                      <small>
                        {p.speaking
                          ? "正在说话"
                          : p.microphone
                            ? "语音已就绪"
                            : "麦克风已关闭"}
                      </small>
                      {!p.local && (
                        <input
                          aria-label={`${p.name}的音量`}
                          type="range"
                          min="0"
                          max="100"
                          defaultValue="100"
                          onChange={(event) =>
                            actions.media.memberVolume(
                              p.id,
                              Number(event.target.value) / 100,
                            )
                          }
                        />
                      )}
                    </div>
                    <span
                      className={`member-quality ${p.quality === "poor" || p.quality === "lost" ? "poor" : ""}`}
                      title={`网络质量：${p.quality === "excellent" ? "优秀" : p.quality === "good" ? "良好" : p.quality === "poor" ? "较差" : p.quality === "lost" ? "已丢失" : "测量中"}`}
                    >
                      <Signal size={12} />
                    </span>
                    <span className={`member-mic ${p.microphone ? "" : "off"}`}>
                      {p.microphone ? <Mic size={16} /> : <MicOff size={16} />}
                    </span>
                    {!p.local && (
                      <div className="member-actions">
                        <button
                          className="icon-button"
                          title="添加好友"
                          aria-label={`添加${p.name}为好友`}
                          onClick={() =>
                            void actions.run(async () => {
                              unwrap(
                                await actions.api.POST("/api/v1/friends", {
                                  body: { userId: p.id },
                                }),
                              );
                              update({ notice: "好友请求已发送" });
                            })
                          }
                        >
                          <UserPlus size={13} />
                        </button>
                        {app.room!.role === "owner" && (
                          <button
                            className="text-button danger"
                            onClick={() =>
                              void actions.run(async () => {
                                unwrap(
                                  await actions.api.DELETE(
                                    "/api/v1/rooms/{roomId}/members/{userId}",
                                    {
                                      params: {
                                        path: {
                                          roomId: app.room!.id,
                                          userId: p.id,
                                        },
                                      },
                                      body: { ban: false },
                                    },
                                  ),
                                );
                              })
                            }
                          >
                            移出
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="panel-note">
                <Headphones size={23} />
                <strong>在这里，声音也有座位。</strong>
                <p>
                  可单独调整每位朋友的音量，
                  <br />
                  聊天声与共享声音互不影响。
                </p>
              </div>
              {app.room!.role === "owner" && (
                <button
                  className="text-button ban-link"
                  onClick={() => update({ modal: "bans" })}
                >
                  <Shield size={13} />
                  管理房间黑名单
                </button>
              )}
            </>
          ) : (
            <Chat />
          )}
        </aside>
      </div>
    </div>
  );
}
function Video() {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    actions.media.setVideoElement(ref.current ?? undefined);
    return () => actions.media.setVideoElement(undefined);
  }, []);
  return <video ref={ref} autoPlay playsInline muted aria-label="共享画面" />;
}
function Volume({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon: ReactNode;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="volume">
      <span>
        {icon}
        {label}
      </span>
      <input
        type="range"
        min="0"
        max="100"
        value={Math.round(value * 100)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
      <small>{Math.round(value * 100)}%</small>
    </label>
  );
}
