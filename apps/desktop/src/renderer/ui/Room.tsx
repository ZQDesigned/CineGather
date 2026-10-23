import { Slider, Alert, Tabs, Tooltip, Tag, Badge } from "antd";
import { Button } from "./Controls";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Shield,
  LockKeyhole,
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
  MessageCircle,
} from "lucide-react";
import { qualityLabel } from "@cinegather/contracts";
import { useApp, update } from "../store";
import * as actions from "../controller";
import { Chat } from "./Chat";
import { Member } from "./Member";
export function Room() {
  const app = useApp();
  const stage = useRef<HTMLDivElement>(null);
  const [memberVolumes, setMemberVolumes] = useState<Record<string, number>>(
    {},
  );
  const local = app.media.participants.find((p) => p.local);
  const sharing = [
    "acquiringLease",
    "selectingSource",
    "publishing",
    "active",
    "stopping",
  ].includes(app.shareState);
  const sharingOwnScreen = sharing || Boolean(app.media.sharer?.local);
  const connected = app.roomState === "connected";
  useEffect(() => {
    if (sharingOwnScreen && document.fullscreenElement === stage.current)
      void document.exitFullscreen().catch(actions.report);
  }, [sharingOwnScreen]);
  const fullscreen = () => {
    if (sharingOwnScreen) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen();
  };
  return (
    <div className="room-page">
      <div className="room-heading">
        <div className="room-title-row">
          <h1 title={app.room!.name}>{app.room!.name}</h1>
          <Tooltip title="复制房间号">
            <Button
              type="text"
              size="small"
              className="room-id"
              title="复制房间号"
              aria-label="复制房间号"
              onClick={() =>
                void actions
                  .copyText(app.room!.code, "房间号已复制")
                  .catch(actions.report)
              }
            >
              {app.room!.code}
              <Copy size={12} />
            </Button>
          </Tooltip>
          <Tag
            icon={
              app.room!.access === "password" ? (
                <LockKeyhole size={11} />
              ) : (
                <Shield size={11} />
              )
            }
          >
            {app.room!.access === "password" ? "加密房" : "普通房"}
          </Tag>
        </div>
        <div className="heading-actions">
          {app.room!.role === "owner" && (
            <Button onClick={() => void actions.run(actions.createInvite)}>
              <UserPlus size={16} />
              邀请朋友
            </Button>
          )}
          <Tooltip title="影院模式">
            <Button
              type="text"
              aria-pressed={app.cinema}
              title="影院模式"
              aria-label="影院模式"
              onClick={() => update({ cinema: !app.cinema })}
            >
              {app.cinema ? <Minimize size={20} /> : <Maximize size={20} />}
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="room-layout">
        <div className="view-column">
          <div
            className={`stage ${app.media.sharer ? "has-video" : ""}`}
            ref={stage}
            onDoubleClick={(event) => {
              if (
                event.target instanceof Element &&
                event.target.closest("button")
              )
                return;
              fullscreen();
            }}
          >
            <Video />
            {!app.media.sharer && (
              <div className="stage-empty">
                <div className="stage-icon">
                  <Clapperboard size={46} strokeWidth={1.3} />
                  <span className="sparkle">✦</span>
                </div>
                <h2>好戏，等你开场</h2>
                <p>共享屏幕，与朋友一起看到同一个世界。</p>
                <Button
                  type="primary"
                  disabled={!connected || sharing}
                  onClick={() => void actions.shareSession.start()}
                >
                  <MonitorUp size={17} />
                  选择屏幕开始共享
                </Button>
                <span className="stage-hint">
                  {qualityLabel(app.settings.quality)}
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
            {!sharingOwnScreen && (
              <Tooltip title="全屏画面">
                <Button
                  type="text"
                  className="stage-fullscreen"
                  title="全屏画面"
                  aria-label="全屏画面"
                  onClick={fullscreen}
                >
                  <Maximize size={17} />
                </Button>
              </Tooltip>
            )}
          </div>
          {app.shareState === "active" && (
            <Alert
              className="sharing-banner"
              type="info"
              showIcon
              title="你正在共享屏幕，请留意画面中的私人信息。"
              action={
                <Button
                  htmlType="button"
                  onClick={() => void actions.stopShare()}
                >
                  停止共享
                </Button>
              }
            />
          )}
          {app.roomState === "failed" && (
            <Alert
              className="reconnect-banner"
              type="error"
              showIcon
              title="连接已断开"
              action={
                <Button
                  htmlType="button"
                  onClick={() => void actions.run(actions.retryRoom)}
                >
                  <RefreshCw size={15} />
                  重新连接
                </Button>
              }
            />
          )}
          <div className="stage-meta">
            <span>
              <ScreenShare size={15} />
              {app.media.sharer ? "实时共享" : "等待共享"}
              <span className="quality-label">
                {qualityLabel(app.settings.quality)}
              </span>
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
              <Button
                type="text"
                aria-pressed={Boolean(local?.microphone)}
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
              </Button>
              <Button
                type="text"
                className="control-settings"
                title="音频设备设置"
                aria-label="音频设备设置"
                onClick={() => update({ modal: "settings" })}
              >
                <Settings size={15} />
              </Button>
            </div>
            <div className="control-divider" />
            <Button
              type="text"
              aria-pressed={sharing}
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
            </Button>
            <Button
              type="text"
              aria-pressed={app.watching}
              className="control-button"
              disabled={!app.media.sharer || app.media.sharer.local}
              onClick={() => {
                actions.media.watch(!app.watching);
                update({ watching: !app.watching });
              }}
            >
              {app.watching ? <Eye size={21} /> : <EyeOff size={21} />}
              <span>{app.watching ? "暂停观看" : "恢复观看"}</span>
            </Button>
            <span className="control-spacer" />
            <Button
              danger
              className="leave-button"
              onClick={() =>
                void actions.run(() => actions.roomSession.leave())
              }
            >
              <LogOut size={18} />
              <span>离开房间</span>
            </Button>
          </div>
          {app.media.audioBlocked && (
            <Button
              className="audio-unlock"
              onClick={() => void actions.media.startAudio()}
            >
              <Volume2 size={16} />
              点击启用房间声音
            </Button>
          )}
        </div>
        <aside className="room-panel">
          <Tabs
            className="room-tabs"
            classNames={{ body: "room-tab-body", content: "room-tab-content" }}
            defaultActiveKey="members"
            destroyOnHidden
            items={[
              {
                key: "members",
                label: (
                  <span>
                    成员{" "}
                    <Badge
                      count={app.media.participants.length}
                      showZero
                      color="#373040"
                    />
                  </span>
                ),
                icon: <Users size={16} />,
                children: (
                  <>
                    <div className="members-list">
                      {app.media.participants.map((p) => (
                        <Member
                          key={p.id}
                          participant={p}
                          room={app.room!}
                          volume={memberVolumes[p.id] ?? 100}
                          onVolumeChange={(value) => {
                            setMemberVolumes((previous) => ({
                              ...previous,
                              [p.id]: value,
                            }));
                            actions.media.memberVolume(p.id, value / 100);
                          }}
                        />
                      ))}
                    </div>

                    {app.room!.role === "owner" && (
                      <Button
                        type="link"
                        className="ban-link"
                        onClick={() => update({ modal: "bans" })}
                      >
                        <Shield size={13} />
                        管理房间黑名单
                      </Button>
                    )}
                  </>
                ),
              },
              {
                key: "chat",
                label: "聊天",
                icon: <MessageCircle size={16} />,
                children: <Chat />,
              },
            ]}
          />
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
      <Slider
        ariaLabelForHandle={label}
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(value) => onChange(value / 100)}
      />
      <small>{Math.round(value * 100)}%</small>
    </label>
  );
}
