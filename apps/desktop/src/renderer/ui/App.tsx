import { useEffect } from "react";
import {
  Signal,
  Clapperboard,
  Film,
  Users,
  Settings,
  Radio,
  Shield,
  LogOut,
  X,
} from "lucide-react";
import { useApp, update } from "../store";
import * as actions from "../controller";
import { Dialogs } from "./Dialogs";
import { Welcome } from "./Welcome";
import { Home } from "./Home";
import { Room } from "./Room";
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
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let ended = false;
    void actions.initialize().then((fn) => {
      if (ended) fn?.();
      else dispose = fn;
    });
    const down = (event: KeyboardEvent) => {
      if (
        event.code === "Space" &&
        !event.repeat &&
        !["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(
          (event.target as HTMLElement).tagName,
        ) &&
        !useApp.getState().modal
      ) {
        event.preventDefault();
        void actions.ptt(true);
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") void actions.ptt(false);
    };
    const blur = () => {
      void actions.ptt(false);
    };
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
    <div className={`app ${app.cinema ? "cinema" : ""}`}>
      <aside className="sidebar">
        <a className="brand" href="#" aria-label="映聚首页">
          <span className="brand-icon">
            <Clapperboard size={23} />
          </span>
          <span>
            映聚<small>CINEGATHER</small>
          </span>
        </a>
        <span className="nav-label">你的放映空间</span>
        <button
          className="nav-item active"
          onClick={() => update({ modal: null })}
        >
          <Film size={18} />
          我的房间<span className="small-count">{app.rooms.length}</span>
        </button>
        <button
          className="nav-item"
          onClick={() => update({ modal: "friends" })}
          disabled={!app.user}
        >
          <Users size={18} />
          好友
        </button>
        <span className="nav-label room-label">最近加入</span>
        <div className="recent-rooms">
          {app.rooms.length ? (
            app.rooms.map((room) => (
              <button
                key={room.id}
                className={`recent-room ${app.room?.id === room.id ? "selected" : ""}`}
                onClick={() =>
                  void actions.run(() => actions.roomSession.enter(room.id))
                }
                disabled={app.busy || app.roomState === "joining"}
              >
                <span className="room-symbol">{room.name[0]}</span>
                <span>
                  {room.name}
                  <small>
                    {room.role === "owner" ? "我创建的房间" : "受邀加入"}
                  </small>
                </span>
                {app.room?.id === room.id && <span className="live-dot" />}
              </button>
            ))
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
              只为彼此的私人空间<small>默认不录制 · 无广告</small>
            </span>
          </div>
          <button
            className="nav-item"
            onClick={() => update({ modal: "settings" })}
          >
            <Settings size={18} />
            设置与设备
          </button>
          <button
            className="nav-item"
            onClick={() => update({ modal: "diagnostics" })}
          >
            <Radio size={18} />
            连接诊断
          </button>
        </div>
        <div className="profile">
          <div className="avatar purple">
            {app.user?.displayName[0] ?? "映"}
          </div>
          <span>
            {app.user?.displayName ?? "欢迎来到映聚"}
            <small>{app.user ? "访客身份" : "等待你的加入"}</small>
          </span>
          {app.user && (
            <button
              className="icon-button"
              title="退出访客身份"
              aria-label="退出访客身份"
              onClick={() => void actions.run(actions.logout)}
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            我的空间<span>/</span>
            {app.room?.name ?? "放映厅"}
          </span>
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
        {(app.error || app.notice) && (
          <div
            className={`toast ${app.error ? "error" : ""}`}
            role={app.error ? "alert" : "status"}
          >
            <span>{app.error ?? app.notice}</span>
            <button
              aria-label="关闭提示"
              className="icon-button"
              onClick={() => update({ error: undefined, notice: undefined })}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {!app.user ? <Welcome /> : app.room ? <Room /> : <Home />}
        <footer className="app-footer">
          <span>
            <Shield size={12} /> PRIVATE ROOMS, SHARED MOMENTS.
          </span>
          <span>
            {window.desktop
              ? `${window.desktop.platform === "darwin" ? "macOS" : "Windows"} 桌面客户端`
              : "浏览器预览 · 系统采集能力请使用桌面客户端"}
          </span>
        </footer>
      </main>
      <Dialogs />
    </div>
  );
}
