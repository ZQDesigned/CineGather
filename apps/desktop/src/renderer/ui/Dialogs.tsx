import { Settings } from "./Settings";
import { useEffect, useState, type FormEvent } from "react";
import {
  Copy,
  Check,
  ArrowRight,
  Monitor,
  AppWindow,
  Download,
  RefreshCw,
  UserPlus,
  Shield,
  X,
} from "lucide-react";
import { useApp, update } from "../store";
import * as actions from "../controller";
import { unwrap } from "@cinegather/api-client";
import { ModalShell } from "./Modal";
export function Dialogs() {
  const modal = useApp((s) => s.modal);
  if (modal === "create") return <CreateRoom />;
  if (modal === "join") return <JoinRoom />;
  if (modal === "settings") return <Settings />;
  if (modal === "invite") return <Invite />;
  if (modal === "source") return <SourcePicker />;
  if (modal === "friends") return <Friends />;
  if (modal === "diagnostics") return <Diagnostics />;
  if (modal === "bans") return <Bans />;
  return null;
}
function CreateRoom() {
  const [name, setName] = useState("今晚一起看");
  const [max, setMax] = useState(5);
  const busy = useApp((s) => s.busy);
  return (
    <ModalShell title="创建私人房间" subtitle="给今晚的相聚，取个好名字。">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void actions.run(() => actions.createRoom(name, max));
        }}
      >
        <label>
          房间名称
          <input
            autoFocus
            required
            maxLength={64}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          房间人数
          <select
            value={max}
            onChange={(event) => setMax(Number(event.target.value))}
          >
            {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => (
              <option key={n} value={n}>
                {n} 人{n === 5 ? " · 默认" : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="form-note">
          <Shield size={16} />
          只有受邀朋友可以加入，默认不录制。
        </div>
        <button className="primary wide" disabled={busy || !name.trim()}>
          {busy ? "正在创建并连接…" : "创建并进入"}
          <ArrowRight size={17} />
        </button>
      </form>
    </ModalShell>
  );
}
function JoinRoom() {
  const value = useApp((s) => s.joinValue);
  const busy = useApp((s) => s.busy);
  return (
    <ModalShell
      title="加入朋友的房间"
      subtitle="把邀请粘贴到这里，见面只差一步。"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void actions.run(() => actions.joinRoom(value));
        }}
      >
        <label>
          邀请链接或完整房间码
          <textarea
            autoFocus
            required
            rows={3}
            value={value}
            onChange={(event) => update({ joinValue: event.target.value })}
            placeholder="cinegather://join?room=…&invite=…"
          />
        </label>
        <p className="form-note">
          完整房间码格式：房间 UUID / 邀请 token。已加入的房间可直接使用完整
          UUID。
        </p>
        <button className="primary wide" disabled={busy || !value.trim()}>
          {busy ? "正在连接…" : "进入房间"}
          <ArrowRight size={17} />
        </button>
      </form>
    </ModalShell>
  );
}
function Invite() {
  const app = useApp();
  const invite = app.invite ?? "";
  const [copied, setCopied] = useState(false);
  return (
    <ModalShell
      title="好座位，留给好朋友"
      subtitle="邀请在 24 小时内有效，最多可供 10 位新成员使用。"
    >
      <div className="invite-art">
        <UserPlus size={38} />
      </div>
      <label>
        房间邀请
        <textarea readOnly rows={3} value={invite} />
      </label>
      <button
        className="primary wide"
        onClick={() =>
          void navigator.clipboard
            .writeText(invite)
            .then(() => setCopied(true))
            .catch(actions.report)
        }
      >
        {copied ? <Check size={17} /> : <Copy size={17} />}{" "}
        {copied ? "已复制，发给朋友吧" : "复制邀请链接"}
      </button>
      <p className="form-note">
        邀请包含私密加入凭证，请只分享给你信任的朋友。
      </p>
      {app.inviteId && app.room && (
        <button
          className="text-button danger"
          onClick={() =>
            void actions.run(async () => {
              unwrap(
                await actions.api.DELETE(
                  "/api/v1/rooms/{roomId}/invites/{inviteId}",
                  {
                    params: {
                      path: { roomId: app.room!.id, inviteId: app.inviteId! },
                    },
                  },
                ),
              );
              update({
                invite: undefined,
                inviteId: undefined,
                modal: null,
                notice: "此邀请已撤销",
              });
            })
          }
        >
          撤销这条邀请
        </button>
      )}
    </ModalShell>
  );
}
function SourcePicker() {
  const app = useApp();
  const [selected, setSelected] = useState(app.sources[0]?.id ?? "");
  const [kind, setKind] = useState("screen");
  return (
    <ModalShell
      title="你想分享哪个画面？"
      subtitle="朋友们只会看到你选择的屏幕或应用窗口。"
      wide
    >
      <div className="source-tabs">
        <button
          className={kind === "screen" ? "selected" : ""}
          onClick={() => setKind("screen")}
        >
          <Monitor size={16} />
          整个屏幕
        </button>
        <button
          className={kind === "window" ? "selected" : ""}
          onClick={() => setKind("window")}
        >
          <AppWindow size={16} />
          应用窗口
        </button>
      </div>
      <div className="source-grid">
        {app.sources
          .filter((s) => s.kind === kind)
          .map((source) => (
            <button
              className={`source-card ${source.id === selected ? "selected" : ""}`}
              key={source.id}
              onClick={() => setSelected(source.id)}
            >
              <img alt={`${source.name}预览`} src={source.thumbnail} />
              <span>
                {source.name}
                {source.id === selected && <Check size={15} />}
              </span>
            </button>
          ))}
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={app.systemAudio}
          onChange={(event) => update({ systemAudio: event.target.checked })}
        />
        <span>
          共享系统声音<small>与麦克风独立传输，观看端可单独调节。</small>
        </span>
      </label>
      <p className="form-note">
        {window.desktop?.platform === "darwin"
          ? "macOS 将通过系统选择器再次确认来源。系统声音取决于系统版本和录音授权。"
          : "Windows 系统音频的远端语音回采仍需实机验证；建议佩戴耳机并先进行回声测试。"}
      </p>
      <button
        className="primary wide"
        disabled={!selected || app.busy}
        onClick={() =>
          void actions.run(() =>
            actions.chooseSource({
              sourceId: selected,
              systemAudio: app.systemAudio,
            }),
          )
        }
      >
        <Monitor size={17} />
        确认共享
      </button>
    </ModalShell>
  );
}
function Friends() {
  const user = useApp((s) => s.user)!;
  const [items, setItems] = useState<
    {
      userId: string;
      displayName: string;
      status: "pending" | "accepted";
      incoming: boolean;
    }[]
  >([]);
  const [target, setTarget] = useState("");
  const load = async () => {
    setItems(unwrap(await actions.api.GET("/api/v1/friends")).items);
  };
  useEffect(() => {
    void load().catch(actions.report);
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void actions.run(async () => {
      unwrap(
        await actions.api.POST("/api/v1/friends", {
          body: { userId: target.trim() },
        }),
      );
      setTarget("");
      await load();
      update({ notice: "好友请求已发送" });
    });
  };
  return (
    <ModalShell title="朋友们" subtitle="把熟悉的名字，留在身边。">
      <button
        className="id-copy"
        onClick={() =>
          void navigator.clipboard
            .writeText(user.id)
            .then(() => update({ notice: "你的用户 ID 已复制" }))
        }
      >
        <span>
          我的用户 ID<small>{user.id}</small>
        </span>
        <Copy size={16} />
      </button>
      <form className="inline-form" onSubmit={submit}>
        <input
          aria-label="好友用户 ID"
          placeholder="粘贴朋友的完整用户 ID"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          required
        />
        <button className="primary" aria-label="发送好友请求">
          <UserPlus size={17} />
        </button>
      </form>
      <div className="friends-list">
        {!items.length && (
          <div className="empty-list">
            暂无好友。你也可以在房间里向成员发送好友请求。
          </div>
        )}
        {items.map((friend) => (
          <div className="friend" key={friend.userId}>
            <div className="avatar amber">{friend.displayName[0]}</div>
            <span>
              {friend.displayName}
              <small>
                {friend.status === "accepted"
                  ? "已成为好友"
                  : friend.incoming
                    ? "邀请你成为好友"
                    : "等待对方接受"}
              </small>
            </span>
            {friend.status === "pending" && friend.incoming && (
              <button
                className="secondary"
                onClick={() =>
                  void actions.run(async () => {
                    unwrap(
                      await actions.api.POST(
                        "/api/v1/friends/{userId}/accept",
                        { params: { path: { userId: friend.userId } } },
                      ),
                    );
                    await load();
                  })
                }
              >
                接受
              </button>
            )}
            <button
              className="icon-button"
              title="移除关系"
              aria-label={`移除${friend.displayName}`}
              onClick={() =>
                void actions.run(async () => {
                  unwrap(
                    await actions.api.DELETE("/api/v1/friends/{userId}", {
                      params: { path: { userId: friend.userId } },
                    }),
                  );
                  await load();
                })
              }
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}
function Diagnostics() {
  const [data, setData] = useState<Record<string, unknown>>({});
  const [server, setServer] = useState<{
    uptimeSeconds: number;
    requests: number;
    errors: number;
    activeRooms: number;
  }>();
  const user = useApp((s) => s.user);
  const refresh = async () => {
    setData(await actions.media.diagnostics());
    if (user) setServer(unwrap(await actions.api.GET("/api/v1/diagnostics")));
  };
  useEffect(() => {
    void refresh().catch(actions.report);
  }, []);
  const exportData = async () => {
    const current = await actions.media.diagnostics();
    if (window.desktop) {
      if (await window.desktop.exportDiagnostics(current))
        update({ notice: "诊断已导出" });
    } else {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(current, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "cinegather-diagnostics.json";
      link.click();
      URL.revokeObjectURL(url);
    }
  };
  return (
    <ModalShell
      title="连接诊断"
      subtitle="仅包含连接和设备指标，不包含媒体内容或访问凭证。"
      wide
    >
      <div className="diagnostic-cards">
        <div>
          <span>媒体状态</span>
          <strong>{String(data.state ?? "未连接")}</strong>
        </div>
        <div>
          <span>服务器活跃房间</span>
          <strong>{server?.activeRooms ?? "—"}</strong>
        </div>
        <div>
          <span>API 请求 / 错误</span>
          <strong>
            {server ? `${server.requests} / ${server.errors}` : "—"}
          </strong>
        </div>
      </div>
      <pre className="diagnostic-json">{JSON.stringify(data, null, 2)}</pre>
      <p className="form-note">
        RTT、丢包、帧率等指标在轨道传输后可见。WebRTC RTT
        不等同于端到端音画延迟。
      </p>
      <div className="dialog-actions">
        <button
          className="secondary"
          onClick={() => void refresh().catch(actions.report)}
        >
          <RefreshCw size={16} />
          刷新
        </button>
        <button
          className="primary"
          onClick={() => void exportData().catch(actions.report)}
        >
          <Download size={16} />
          导出诊断
        </button>
      </div>
    </ModalShell>
  );
}
function Bans() {
  const room = useApp((s) => s.room)!;
  const [items, setItems] = useState<{ userId: string; displayName: string }[]>(
    [],
  );
  const [target, setTarget] = useState("");
  const load = async () =>
    setItems(
      unwrap(
        await actions.api.GET("/api/v1/rooms/{roomId}/bans", {
          params: { path: { roomId: room.id } },
        }),
      ).items,
    );
  useEffect(() => {
    void load().catch(actions.report);
  }, []);
  return (
    <ModalShell
      title="房间黑名单"
      subtitle="仅房主可以禁止或恢复成员的加入权限。"
    >
      <form
        className="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          void actions.run(async () => {
            unwrap(
              await actions.api.DELETE(
                "/api/v1/rooms/{roomId}/members/{userId}",
                {
                  params: { path: { roomId: room.id, userId: target.trim() } },
                  body: { ban: true },
                },
              ),
            );
            setTarget("");
            await load();
          });
        }}
      >
        <input
          aria-label="要封禁的用户 ID"
          placeholder="输入完整用户 ID"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          required
        />
        <button className="primary" aria-label="封禁成员">
          <Shield size={17} />
        </button>
      </form>
      <div className="friends-list">
        {!items.length && <p className="empty-list">没有被禁止加入的成员。</p>}
        {items.map((member) => (
          <div className="friend" key={member.userId}>
            <div className="avatar amber">{member.displayName[0]}</div>
            <span>{member.displayName}</span>
            <button
              className="secondary"
              onClick={() =>
                void actions.run(async () => {
                  unwrap(
                    await actions.api.DELETE(
                      "/api/v1/rooms/{roomId}/bans/{userId}",
                      {
                        params: {
                          path: { roomId: room.id, userId: member.userId },
                        },
                      },
                    ),
                  );
                  await load();
                })
              }
            >
              解除封禁
            </button>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}
