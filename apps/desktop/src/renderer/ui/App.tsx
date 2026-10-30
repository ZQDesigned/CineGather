import { AnnouncementLayer } from "./Announcements";
import { NotificationCenter } from "./NotificationCenter";
import { DoNotDisturb } from "./DoNotDisturb";

import { version } from "../../../package.json";
import { Button, Menu, Avatar, Badge, Breadcrumb, Tooltip, Space } from "antd";
import { useEffect, useState } from "react";
import {
  Signal,
  Clapperboard,
  Film,
  Users,
  Settings,
  Radio,
  LogOut,
  ShieldCheck,
  Download,
} from "lucide-react";
import { useApp, update } from "../store";
import * as actions from "../controller";
import { Admin } from "./Admin";
import { Friends } from "./Friends";
import { Dialogs } from "./Dialogs";
import { Welcome } from "./Welcome";
import { Home } from "./Home";
import { Room } from "./Room";
import { Feedback } from "./Feedback";
import { WindowControls } from "./WindowControls";
import { UpdateCenter } from "./Updates";
import { AppSurface } from "./styles";
import { hasAdminAccess } from "@cinegather/contracts";
import { capabilities } from "../platform";
import { matchesShortcut } from "../../shared/shortcuts";
import { buildMemberOverlay } from "../../shared/member-overlay";
import { hasIncomingRequests } from "../friends";
import { PresenceAvatar } from "./Presence";
import {
  RoomInvitationInboxButton,
  RoomInvitationNotifications,
} from "./RoomInvitations";
import {
  RoomRequestInboxButton,
  RoomRequestNotifications,
} from "./RoomJoinRequests";
const roomStates: Record<string, string> = {
  idle: "未连接房间",
  authenticating: "正在验证身份",
  joining: "正在进入房间",
  connected: "已连接",
  reconnecting: "正在重新连接",
  leaving: "正在离开",
  failed: "连接已断开",
};
function readSection(): "main" | "admin" | "friends" {
  const route = location.hash
    ? location.hash.slice(1)
    : location.pathname.replace(/\/$/, "");
  return route === "/admin"
    ? "admin"
    : route === "/friends"
      ? "friends"
      : "main";
}
const mainPath = () =>
  /^\/(admin|friends)\/?$/.test(location.pathname) ? "/" : location.pathname;
export function App() {
  const app = useApp();
  const [home, setHome] = useState(false);
  const [section, setSection] = useState(readSection);
  const admin = section === "admin";
  const secondary = section !== "main";
  const showHome = () => {
    setSection("main");
    setHome(true);
    history.replaceState(null, "", mainPath());
  };
  useEffect(() => {
    const changed = () => setSection(readSection());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    setHome(false);
    if (app.room) {
      setSection("main");
      history.replaceState(null, "", mainPath());
    }
  }, [app.room?.id]);
  useEffect(() => {
    if (!app.chatRequest || !app.room) return;
    setHome(false);
    setSection("main");
    history.replaceState(null, "", mainPath());
  }, [app.chatRequest]);
  useEffect(() => {
    const bridge = window.desktop?.memberOverlay;
    if (!bridge) return;
    let previous: string | undefined;
    const publish = () => {
      const snapshot = buildMemberOverlay(useApp.getState());
      const serialized = JSON.stringify(snapshot);
      if (previous === serialized) return;
      previous = serialized;
      void bridge.publish(snapshot).catch(actions.report);
    };
    const unsubscribe = useApp.subscribe(publish);
    publish();
    return () => {
      unsubscribe();
      void bridge.publish(null).catch(() => {});
    };
  }, []);
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let ended = false;
    void actions.initialize().then((fn) => {
      if (ended) fn?.();
      else dispose = fn;
    });
    let holdActive = false;
    const down = (event: KeyboardEvent) => {
      const current = useApp.getState();
      if (current.requiredUpdate) return;
      const platform = capabilities();
      if (
        !platform.globalShortcuts &&
        !current.modal &&
        current.roomState === "connected" &&
        !(
          event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, [role="combobox"], [contenteditable="true"]',
          )
        )
      ) {
        const key = {
          code: event.code,
          control: event.ctrlKey,
          meta: event.metaKey,
          alt: event.altKey,
          shift: event.shiftKey,
          isAutoRepeat: event.repeat,
          isComposing: event.isComposing,
        };
        if (
          matchesShortcut(current.settings.muteShortcut, key, platform.platform)
        ) {
          event.preventDefault();
          void actions.toggleMicrophone();
          return;
        }
      }
      if (
        platform.pushToTalk &&
        current.settings.pushToTalk &&
        current.roomState === "connected" &&
        event.code === "Space" &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.repeat &&
        !(
          event.target instanceof Element &&
          event.target.closest(
            'input, textarea, select, button, [role="combobox"], [role="slider"], [role="tab"], [role="menuitem"], [role="radio"], a, [contenteditable="true"]',
          )
        ) &&
        !current.modal
      ) {
        event.preventDefault();
        holdActive = true;
        void actions.ptt(true);
      }
    };
    const releaseHold = () => {
      if (!holdActive) return;
      holdActive = false;
      void actions.ptt(false);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space" || !capabilities().globalShortcuts)
        releaseHold();
    };
    const blur = releaseHold;
    const exit = () => {
      void actions.roomSession.leave();
    };
    const visibility = () => {
      if (document.hidden) releaseHold();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("beforeunload", exit);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      ended = true;
      dispose?.();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("beforeunload", exit);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return (
    <AppSurface
      className={`app ${app.cinema ? "cinema" : ""}`}
      data-platform={window.desktop?.platform ?? "browser"}
    >
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          aria-label="映聚首页"
          onClick={(e) => {
            e.preventDefault();
            showHome();
          }}
        >
          <span className="brand-icon">
            <Clapperboard size={23} />
          </span>
          <span>映聚</span>
        </a>
        <span className="nav-label">你的放映空间</span>
        <Menu
          className="sidebar-menu"
          mode="inline"
          selectedKeys={
            secondary ? [section] : app.room && !home ? [] : ["home"]
          }
          items={[
            ...(hasAdminAccess(app.user)
              ? [
                  {
                    key: "admin",
                    icon: <ShieldCheck size={18} />,
                    label: "管理后台",
                    onClick: () => {
                      setSection("admin");
                      location.hash = "/admin";
                      update({ modal: null });
                    },
                  },
                ]
              : []),
            {
              key: "home",
              icon: <Film size={18} />,
              label: (
                <span>
                  我的房间{" "}
                  <Badge count={app.rooms.length} showZero color="#373040" />
                </span>
              ),
              onClick: () => {
                showHome();
                update({ modal: null });
              },
            },
            {
              key: "friends",
              icon: (
                <Badge
                  className="friend-request-indicator"
                  dot={Boolean(app.user) && hasIncomingRequests(app.friends)}
                  aria-hidden="true"
                >
                  <Users size={18} />
                </Badge>
              ),
              label: "好友",
              disabled: !app.user,
              onClick: () => {
                setSection("friends");
                location.hash = "/friends";
                update({ modal: null });
              },
            },
          ]}
        />
        <span className="nav-label room-label">最近加入</span>
        <div className="recent-rooms">
          {app.rooms.length ? (
            <Menu
              className="sidebar-menu room-menu"
              mode="inline"
              selectedKeys={
                app.room && !home && !secondary ? [app.room.id] : []
              }
              items={app.rooms.map((room) => ({
                key: room.id,
                icon: (
                  <Avatar size={28} shape="square">
                    {room.name[0]}
                  </Avatar>
                ),
                label: room.name,
                disabled: app.busy || app.roomState === "joining",
                onClick: () => {
                  void actions.run(async () => {
                    if (await actions.enterKnownRoom(room)) {
                      showHome();
                      setHome(false);
                    }
                  });
                },
              }))}
            />
          ) : (
            <p className="sidebar-empty">
              相聚之后，
              <br />
              这里会留下你的房间。
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <Menu
            className="sidebar-menu"
            mode="inline"
            selectedKeys={[]}
            items={[
              ...(!capabilities().desktop
                ? [
                    {
                      key: "download",
                      icon: <Download size={18} />,
                      label: "下载客户端",
                      onClick: () => update({ modal: "download" }),
                    },
                  ]
                : []),
              {
                key: "settings",
                icon: <Settings size={18} />,
                label: "设置与设备",
                onClick: () => update({ modal: "settings" }),
              },
              {
                key: "diagnostics",
                icon: <Radio size={18} />,
                label: "连接诊断",
                onClick: () => update({ modal: "diagnostics" }),
              },
            ]}
          />
        </div>
        <div className="profile">
          <PresenceAvatar />
          <span className="profile-details">
            <span className="profile-name" title={app.user?.displayName}>
              {app.user?.displayName ?? "欢迎来到映聚"}
            </span>
            <small title={app.user?.username ?? undefined}>
              {app.user?.username ?? "等待你的加入"}
            </small>
          </span>
          {app.user && (
            <Tooltip title={"退出登录"}>
              <Button
                type="text"
                aria-label={"退出登录"}
                onClick={() => void actions.run(actions.logout)}
              >
                <LogOut size={16} />
              </Button>
            </Tooltip>
          )}
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <Breadcrumb
            items={[
              { title: "我的空间" },
              {
                title: admin
                  ? "管理后台"
                  : section === "friends"
                    ? "好友"
                    : app.room && !home
                      ? app.room.name
                      : "放映厅",
              },
            ]}
          />
          <div className="topbar-right">
            <RoomInvitationInboxButton />
            <RoomRequestInboxButton />
            {(home || secondary) && app.room && (
              <Space.Compact
                className="current-room"
                role="group"
                aria-label="当前加入的房间"
                size="small"
              >
                <Tooltip title={`返回房间：${app.room.name}`}>
                  <Button
                    className="current-room-link"
                    icon={<Film size={14} />}
                    aria-label="返回当前房间"
                    disabled={app.busy || app.roomState === "leaving"}
                    onClick={() => {
                      showHome();
                      setHome(false);
                    }}
                  >
                    <span className="current-room-name">{app.room.name}</span>
                    <Badge count={app.chat.unread} size="small" />
                  </Button>
                </Tooltip>
                <Tooltip title="退出当前房间">
                  <Button
                    danger
                    className="current-room-exit"
                    icon={<LogOut size={14} />}
                    aria-label="退出当前房间"
                    loading={app.roomState === "leaving"}
                    disabled={app.busy || app.roomState === "leaving"}
                    onClick={() =>
                      void actions.run(() => actions.roomSession.leave())
                    }
                  >
                    退出
                  </Button>
                </Tooltip>
              </Space.Compact>
            )}
            {app.roomState === "connected" &&
              app.media.participants.some(
                (p) => p.quality === "poor" || p.quality === "lost",
              ) && (
                <span
                  className="network-warning"
                  title="可在设置中切换省流画质"
                >
                  <Signal size={13} />
                  网络不稳定
                </span>
              )}
            <span
              className={`connection ${app.roomState === "connected" ? "online" : ""}`}
            >
              <span />
              {roomStates[app.roomState]}
            </span>
            <DoNotDisturb />
            <NotificationCenter />
            <span className="version">v{version}</span>
            <WindowControls />
          </div>
        </header>
        <AnnouncementLayer />
        <Feedback />
        <RoomInvitationNotifications />
        <RoomRequestNotifications />
        <UpdateCenter />
        {!app.user ? (
          <Welcome />
        ) : (
          <>
            {app.room && (
              <div className="room-slot" hidden={home || secondary}>
                <Room visible={!home && !secondary} />
              </div>
            )}
            {admin ? (
              <Admin onHome={showHome} />
            ) : section === "friends" ? (
              <Friends />
            ) : (
              (!app.room || home) && <Home onEnterRoom={() => setHome(false)} />
            )}
          </>
        )}
      </main>
      <Dialogs />
    </AppSurface>
  );
}
