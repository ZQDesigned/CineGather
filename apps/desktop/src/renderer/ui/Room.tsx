import { WatchProfileControl, WatchAdvice } from "./WatchProfile";
import {
  useRoomActivityConnection,
  RoomActivityStage,
  RoomActivityControls,
  ActivityNotifications,
} from "./RoomActivities";

import { PictureInPicture2 } from "lucide-react";
import { useViewingWindow } from "./ViewingWindow";
import { ShareQueue } from "./ShareQueue";
import { ShareDebugOverlay } from "./ShareDebugOverlay";
import { App, Slider, Alert, Tabs, Tooltip, Tag, Badge, Popover } from "antd";
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
  LogOut,
  MessageCircle,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { qualityLabel } from "@cinegather/contracts";
import { useApp, update } from "../store";
import * as actions from "../controller";
import { AccompanimentControl } from "./Accompaniment";
import { MicrophoneEffectControl } from "./MicrophoneEffect";
import { AudioQuickControl } from "./AudioQuickControl";
import { Chat } from "./Chat";
import { Member } from "./Member";
import { capabilities } from "../platform";
import { useCapturePreview } from "./useCapturePreview";
import { RoomActivityLayout, ActivityVolumePanel } from "./RoomActivityLayout";
import { activityMemberStatus } from "../room-activity-ui";
import {
  deviceAudioTitle,
  deviceAudioDescription,
} from "../audio-compatibility";
export function Room({ visible = true }: { visible?: boolean }) {
  const app = useApp();
  const activity = useRoomActivityConnection();
  const activityVisible =
    activity.snapshot?.kind === "board" || activity.snapshot?.kind === "game";
  const [activityToolbar, setActivityToolbar] = useState<HTMLDivElement | null>(
    null,
  );
  const [activityFocus, setActivityFocus] = useState(false);
  const [activityPanel, setActivityPanel] = useState<boolean>();
  const [narrowActivity, setNarrowActivity] = useState(
    () => matchMedia("(max-width: 1050px)").matches,
  );
  const [volumeOpen, setVolumeOpen] = useState(false);
  const volumeTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const query = matchMedia("(max-width: 1050px)");
    const changed = () => setNarrowActivity(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    setActivityFocus(false);
    setActivityPanel(undefined);
    setVolumeOpen(false);
  }, [app.room?.id, activityVisible]);
  useEffect(() => {
    if (!visible) setVolumeOpen(false);
  }, [visible]);
  useEffect(() => {
    if (!activityVisible || !activityFocus || !visible) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Dialogs and popovers get first use of Esc.
      if (
        document.querySelector(
          '.ant-modal-wrap:not([style*="display: none"]), .ant-popover:not(.ant-popover-hidden), .ant-dropdown:not(.ant-dropdown-hidden)',
        )
      )
        return;
      setActivityFocus(false);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [activityVisible, activityFocus, visible]);
  useEffect(() => {
    if (!activityVisible || !volumeOpen || !visible) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setVolumeOpen(false);
      volumeTrigger.current?.focus();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [activityVisible, volumeOpen, visible]);
  const { modal } = App.useApp();
  const stage = useRef<HTMLDivElement>(null);
  const local = app.media.participants.find((p) => p.local);
  const policy = app.room?.memberPermissions?.find(
    (p) => p.userId === app.user?.id,
  );
  const micBlocked =
    policy?.microphoneAllowed === false || local?.microphoneAllowed === false;
  const shareBlocked = policy?.sharingAllowed === false;
  const sharing = [
    "acquiringLease",
    "selectingSource",
    "publishing",
    "active",
    "stopping",
  ].includes(app.shareState);
  const sharingOwnScreen = sharing || Boolean(app.media.sharer?.local);
  const nativeSharing =
    app.shareState === "active" && Boolean(window.desktop?.nativeCapture);
  const preview = useCapturePreview(
    nativeSharing && visible
      ? `${app.room!.id}:${app.shareRevision}`
      : undefined,
  );
  useEffect(() => {
    actions.media.setPreviewVideoElement(
      nativeSharing ? (preview.video.current ?? undefined) : undefined,
    );
    return () => actions.media.setPreviewVideoElement(undefined);
  }, [nativeSharing, preview.video]);
  const otherSharing =
    !nativeSharing && Boolean(app.media.sharer && !app.media.sharer.local);
  const viewingWindow = useViewingWindow(
    otherSharing && app.media.watching && app.roomState === "connected",
  );
  const canPreempt = app.room?.role === "owner" && otherSharing && !sharing;
  const connected = app.roomState === "connected";
  useEffect(() => {
    if (sharingOwnScreen && document.fullscreenElement === stage.current)
      void document.exitFullscreen().catch(actions.report);
  }, [sharingOwnScreen]);
  const fullscreen = () => {
    if (sharingOwnScreen || !capabilities().fullscreen) return;
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(actions.report);
    else void stage.current?.requestFullscreen().catch(actions.report);
  };
  const volumes = (
    <>
      <Volume
        label="他人语音"
        icon={<Headphones size={17} />}
        value={app.voiceVolume}
        onChange={(value) => {
          update({ voiceVolume: value });
          actions.media.voiceVolume(value);
        }}
      />
      {!activityVisible && <div className="mixer-divider" />}
      <Volume
        label="共享声音"
        icon={<Film size={17} />}
        value={app.screenVolume}
        onChange={(value) => {
          update({ screenVolume: value });
          actions.media.screenVolume(value);
        }}
      />
    </>
  );
  const panelCollapsed =
    activityFocus ||
    activityPanel === false ||
    (activityPanel === undefined && narrowActivity);
  return (
    <RoomActivityLayout
      className={`room-page ${activityVisible ? "activity-workspace" : ""} ${activityVisible && activityFocus ? "activity-focus" : ""} ${activityVisible && panelCollapsed ? "activity-panel-collapsed" : ""} ${activityVisible && activityPanel === true && !activityFocus ? "activity-panel-expanded" : ""}`}
    >
      <ActivityNotifications />
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
          <div
            className="activity-heading-toolbar"
            ref={setActivityToolbar}
            style={activityVisible ? undefined : { display: "none" }}
          />
          {app.room!.role === "owner" && (
            <Button onClick={() => update({ modal: "room-settings" })}>
              <Settings size={16} />
              房间设置
            </Button>
          )}
          <Button onClick={() => void actions.run(actions.createInvite)}>
            <UserPlus size={16} />
            邀请朋友
          </Button>
          {activityVisible ? (
            <>
              <Button
                aria-label={activityFocus ? "退出专注" : "专注画板"}
                aria-pressed={activityFocus}
                onClick={() => setActivityFocus(!activityFocus)}
              >
                {activityFocus ? (
                  <Minimize size={18} />
                ) : (
                  <Maximize size={18} />
                )}
                {activityFocus ? "退出专注" : "专注画板"}
              </Button>
              <Button
                aria-label={panelCollapsed ? "展开成员栏" : "收起成员栏"}
                aria-expanded={!panelCollapsed}
                aria-controls="room-members-panel"
                onClick={() => {
                  if (activityFocus) {
                    setActivityFocus(false);
                    setActivityPanel(true);
                  } else setActivityPanel(panelCollapsed);
                }}
              >
                {panelCollapsed ? (
                  <PanelRightOpen size={18} />
                ) : (
                  <PanelRightClose size={18} />
                )}
              </Button>
            </>
          ) : (
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
          )}
        </div>
      </div>
      {app.audioCompatibility && sharing && (
        <Alert
          className="audio-compatibility-alert"
          type="warning"
          showIcon
          title={deviceAudioTitle}
          description={deviceAudioDescription}
        />
      )}
      <div className="room-layout">
        <div className="view-column">
          <RoomActivityControls
            compact={activityVisible}
            visible={visible}
            toolbarTarget={activityVisible ? activityToolbar : null}
          />
          <RoomActivityStage />
          <div
            style={activityVisible ? { display: "none" } : undefined}
            className={`stage ${!nativeSharing && app.media.sharer?.hasVideo ? "has-video" : ""}`}
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
            {nativeSharing ? (
              <video
                ref={preview.video}
                className="local-share-preview"
                autoPlay
                playsInline
                muted
                hidden={!nativeSharing || preview.status !== "playing"}
                aria-label="本地共享预览"
              />
            ) : (
              <Video />
            )}
            {viewingWindow.presentation}
            {!viewingWindow.active && <ShareDebugOverlay visible={visible} />}
            {viewingWindow.active && (
              <div className="stage-empty">
                <PictureInPicture2 size={42} />
                <h2>正在小窗观看</h2>
                <Button onClick={viewingWindow.close}>返回主窗口</Button>
              </div>
            )}
            {!app.media.sharer && !nativeSharing && (
              <div className="stage-empty">
                <div className="stage-icon">
                  <Clapperboard size={46} strokeWidth={1.3} />
                  <span className="sparkle">✦</span>
                </div>
                <h2>好戏，等你开场</h2>
                <p>共享屏幕，与朋友一起看到同一个世界。</p>
                <Button
                  type="primary"
                  disabled={!connected || sharing || shareBlocked}
                  onClick={() => void actions.shareSession.start()}
                >
                  <MonitorUp size={17} />
                  {shareBlocked ? "已被禁止共享" : "选择屏幕开始共享"}
                </Button>
                <span className="stage-hint">
                  {qualityLabel(app.settings.quality)}
                </span>
              </div>
            )}
            {otherSharing && !app.media.watching && (
              <div className="stage-empty stage-join">
                <div className="stage-icon">
                  <ScreenShare size={46} strokeWidth={1.3} />
                </div>
                <h2>{app.media.sharer!.name} 正在共享</h2>
                <Button
                  type="primary"
                  disabled={!connected}
                  onClick={() =>
                    void actions.watchShare(true).catch(actions.report)
                  }
                >
                  <Eye size={17} />
                  加入观看
                </Button>
              </div>
            )}
            {(nativeSharing || app.media.sharer?.local) &&
              (nativeSharing || !app.media.sharer?.hasVideo) &&
              preview.status !== "playing" && (
                <div className="stage-empty">
                  <div className="stage-icon">
                    <ScreenShare size={46} strokeWidth={1.3} />
                  </div>
                  <h2>你正在共享屏幕</h2>
                  {nativeSharing && (
                    <p>
                      {preview.status === "unavailable"
                        ? "本地预览暂不可用"
                        : preview.status === "paused"
                          ? "本地预览已暂停"
                          : "正在加载本地预览"}
                    </p>
                  )}
                </div>
              )}
            {app.media.sharer && (
              <div className="video-label">
                <span className="live-dot" />
                {nativeSharing || app.media.sharer.local
                  ? "你"
                  : app.media.sharer.name}
                正在共享
                {app.media.systemAudio && (
                  <span>
                    <Volume2 size={13} />
                    含共享声音
                  </span>
                )}
              </div>
            )}
            <div className="stage-view-controls">
              {viewingWindow.control}
              {!sharingOwnScreen &&
                !viewingWindow.active &&
                (!otherSharing || app.media.watching) &&
                capabilities().fullscreen && (
                  <Button
                    type="text"
                    className="stage-action"
                    aria-label="全屏画面"
                    onClick={fullscreen}
                    icon={<Maximize size={17} />}
                  />
                )}
            </div>
          </div>
          {app.shareState === "active" && (
            <Alert
              className="sharing-banner"
              type="info"
              showIcon
              title="你正在共享屏幕，请留意画面中的私人信息。"
              action={
                <div className="share-actions">
                  <Button
                    loading={app.switchingSource}
                    disabled={!connected}
                    onClick={() => void actions.switchShareSource()}
                  >
                    切换来源
                  </Button>
                  <Button
                    htmlType="button"
                    onClick={() => void actions.stopShare()}
                  >
                    停止共享
                  </Button>
                </div>
              }
            />
          )}
          {app.shareRecovery && app.shareState === "idle" && (
            <Alert
              type="warning"
              showIcon
              title={app.shareRecovery}
              action={
                <Button
                  disabled={!connected}
                  onClick={() => void actions.shareSession.start()}
                >
                  重新选择来源
                </Button>
              }
              closable
              onClose={() => update({ shareRecovery: undefined })}
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
          <div
            className="stage-meta"
            style={activityVisible ? { display: "none" } : undefined}
          >
            <span>
              <ScreenShare size={15} />
              {app.media.sharer ? "实时共享" : "等待共享"}
              <span className="quality-label">
                {app.media.sharer && !app.media.sharer.local ? (
                  <WatchProfileControl />
                ) : (
                  qualityLabel(app.settings.quality)
                )}
              </span>
            </span>
            <span>
              <Users size={14} />
              {app.media.participants.length} / {app.room!.maxMembers} 位朋友
            </span>
          </div>
          <WatchAdvice />
          {!activityVisible && <div className="mixer-card">{volumes}</div>}
          <div className="controls">
            <div className="control-group">
              <Button
                type="text"
                aria-pressed={Boolean(local?.microphone)}
                className={`control-button ${!local?.microphone ? "muted-control" : ""}`}
                disabled={!connected || micBlocked}
                title={micBlocked ? "房主已禁止你在此房间开麦" : undefined}
                onClick={() => void actions.toggleMicrophone()}
                aria-label={local?.microphone ? "关闭麦克风" : "开启麦克风"}
              >
                {local?.microphone ? <Mic size={21} /> : <MicOff size={21} />}
                <span>
                  {micBlocked
                    ? "已被禁止开麦"
                    : capabilities().pushToTalk && app.settings.pushToTalk
                      ? "按住空格说话"
                      : local?.microphone
                        ? "麦克风已开启"
                        : "麦克风已关闭"}
                </span>
              </Button>
              <AudioQuickControl disabled={!connected} />
            </div>
            <MicrophoneEffectControl disabled={!connected} />
            <div className="control-divider" />
            {!activityVisible && (!otherSharing || canPreempt || sharing) && (
              <Button
                type="text"
                aria-pressed={sharing}
                className={`control-button ${sharing ? "sharing-control" : ""}`}
                disabled={
                  !connected ||
                  (shareBlocked && !sharing) ||
                  (otherSharing && !canPreempt && !sharing)
                }
                onClick={() => {
                  if (sharing) void actions.stopShare();
                  else if (canPreempt)
                    modal.confirm({
                      title: "抢占当前共享？",
                      content: `将停止${app.media.sharer!.name}的共享，并开始选择你的共享画面。`,
                      okText: "抢占共享",
                      cancelText: "取消",
                      onOk: () => {
                        void actions.shareSession.start(true);
                      },
                    });
                  else void actions.shareSession.start();
                }}
              >
                <MonitorUp size={21} />
                <span>
                  {sharing
                    ? app.shareState === "active"
                      ? "停止共享"
                      : "取消共享"
                    : shareBlocked
                      ? "已被禁止共享"
                      : canPreempt
                        ? "抢占共享"
                        : "共享屏幕"}
                </span>
              </Button>
            )}
            {!activityVisible && <ShareQueue key={app.room!.id} />}
            {otherSharing && app.media.watching && (
              <Button
                type="text"
                aria-pressed
                className="control-button"
                disabled={!connected}
                onClick={() =>
                  void actions.watchShare(false).catch(actions.report)
                }
              >
                <Eye size={21} />
                <span>暂停观看</span>
              </Button>
            )}
            <AccompanimentControl disabled={!connected || micBlocked} />
            <Popover
              trigger="click"
              placement="top"
              open={visible && activityVisible && volumeOpen}
              onOpenChange={setVolumeOpen}
              content={
                <ActivityVolumePanel role="region" aria-label="房间播放音量">
                  {volumes}
                </ActivityVolumePanel>
              }
            >
              <Button
                ref={volumeTrigger}
                type="text"
                className="activity-volume-trigger"
                aria-label="播放音量"
                style={activityVisible ? undefined : { display: "none" }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setVolumeOpen(false);
                    event.currentTarget.focus();
                    event.stopPropagation();
                  }
                }}
              >
                <Volume2 size={17} />
                音量
              </Button>
            </Popover>
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
              onClick={() =>
                void actions.media.startAudio().catch(actions.report)
              }
            >
              <Volume2 size={16} />
              点击启用房间声音
            </Button>
          )}
        </div>
        <aside className="room-panel" id="room-members-panel">
          <Tabs
            className="room-tabs"
            classNames={{ body: "room-tab-body", content: "room-tab-content" }}
            activeKey={app.chatTab}
            onChange={(key) => update({ chatTab: key as "members" | "chat" })}
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
                        <div
                          key={p.id}
                          className="activity-member-entry"
                          style={
                            activityVisible
                              ? undefined
                              : { display: "contents" }
                          }
                        >
                          <Member
                            key={p.id}
                            participant={p}
                            room={app.room!}
                            volume={app.memberVolumes[p.id] ?? 100}
                            onVolumeChange={(value) =>
                              actions.setMemberVolume(p.id, value)
                            }
                            onVolumeCommit={(value) =>
                              void actions
                                .commitMemberVolume(p.id, value)
                                .catch(actions.report)
                            }
                          />
                          {activityVisible && activity.snapshot?.game && (
                            <div className="activity-member-status">
                              {activityMemberStatus(
                                activity.snapshot.game,
                                p.id,
                              )}
                            </div>
                          )}
                        </div>
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
                label: (
                  <span className="chat-tab-label">
                    聊天
                    <Badge count={app.chat.unread} size="small" />
                  </span>
                ),
                icon: <MessageCircle size={16} />,
                children: (
                  <Chat
                    active={
                      visible &&
                      app.chatTab === "chat" &&
                      (!activityVisible || !panelCollapsed)
                    }
                  />
                ),
              },
            ]}
          />
        </aside>
      </div>
    </RoomActivityLayout>
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
