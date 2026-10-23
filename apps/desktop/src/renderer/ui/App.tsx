import { Button, Menu, Avatar, Badge, Breadcrumb, Tooltip } from "antd";
import { useEffect, useState } from "react";
import {
  Signal,
  Clapperboard,
  Film,
  Users,
  Settings,
  Radio,
  Shield,
  LogOut,
} from "lucide-react";
import { useApp, update } from "../store";
import * as actions from "../controller";
import { Dialogs } from "./Dialogs";
import { Welcome } from "./Welcome";
import { Home } from "./Home";
import { Room } from "./Room";
import { Feedback } from "./Feedback";
import { AppSurface } from "./styles";
const roomStates: Record<string, string> = {
  idle: "未连接房间",
  authenticating: "正在验证身份",
  joining: "正在进入房间",
  connected: "已连接",
  reconnecting: "正在重新连接",
  leaving: "正在离开",
  failed: "连接已断开",
};
export function App() {
  const app = useApp();
  const [home, setHome] = useState(false);
  useEffect(() => setHome(false), [app.room?.id]);
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
      if (
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
      if (event.code === "Space") releaseHold();
    };
    const blur = releaseHold;
    const exit = () => {
      void actions.roomSession.leave();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    window.addEventListener("beforeunload", exit);
    return () => {
      ended = true;
      dispose?.();
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
      window.removeEventListener("beforeunload", exit);
    };
  }, []);
  return (
    <AppSurface className={`app ${app.cinema ? "cinema" : ""}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          aria-label="映聚首页"
          onClick={(e) => {
            e.preventDefault();
            setHome(true);
          }}
        >
          <span className="brand-icon">
            <Clapperboard size={23} />
          </span>
          <span>
            映聚<small>CINEGATHER</small>
          </span>
        </a>
        <span className="nav-label">你的放映空间</span>
        <Menu
          className="sidebar-menu"
          mode="inline"
          selectedKeys={app.room && !home ? [] : ["home"]}
          items={[
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
                setHome(true);
                update({ modal: null });
              },
            },
            {
              key: "friends",
              icon: <Users size={18} />,
              label: "好友",
              disabled: !app.user,
              onClick: () => update({ modal: "friends" }),
            },
          ]}
        />
        <span className="nav-label room-label">最近加入</span>
        <div className="recent-rooms">
          {app.rooms.length ? (
            <Menu
              className="sidebar-menu room-menu"
              mode="inline"
              selectedKeys={app.room && !home ? [app.room.id] : []}
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
                  setHome(false);
                  if (app.room?.id !== room.id)
                    void actions.run(() => actions.roomSession.enter(room.id));
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
          <div className="privacy-note">
            <Shield size={17} />
            <span>
              只为彼此的私人空间<small>默认不录制，无广告</small>
            </span>
          </div>
          <Menu
            className="sidebar-menu"
            mode="inline"
            selectedKeys={[]}
            items={[
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
          <Avatar className="purple">{app.user?.displayName[0] ?? "映"}</Avatar>
          <span>
            {app.user?.displayName ?? "欢迎来到映聚"}
            <small>{app.user ? "访客身份" : "等待你的加入"}</small>
          </span>
          {app.user && (
            <Tooltip title="退出访客身份">
              <Button
                type="text"
                title="退出访客身份"
                aria-label="退出访客身份"
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
              { title: app.room && !home ? app.room.name : "放映厅" },
            ]}
          />
          <div className="topbar-right">
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
            <span className="version">v0.1.0</span>
          </div>
        </header>
        <Feedback />
        {!app.user ? (
          <Welcome />
        ) : (
          <>
            {app.room && (
              <div className="room-slot" hidden={home}>
                <Room />
              </div>
            )}
            {(!app.room || home) && <Home onEnterRoom={() => setHome(false)} />}
          </>
        )}
      </main>
      <Dialogs />
    </AppSurface>
  );
}
