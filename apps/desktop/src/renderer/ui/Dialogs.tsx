import { Select, Checkbox } from "antd";
import { Button, TextArea, Input } from "./Controls";
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
          <Input
            autoFocus
            required
            maxLength={64}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          房间人数
          <Select
            aria-label="房间人数"
            value={max}
            onChange={setMax}
            options={Array.from({ length: 9 }, (_, i) => ({
              value: i + 2,
              label: `${i + 2} 人${i + 2 === 5 ? " · 默认" : ""}`,
            }))}
          />
        </label>
        <div className="form-note">
          <Shield size={16} />
          只有受邀朋友可以加入，默认不录制。
        </div>
        <Button className="primary wide" disabled={busy || !name.trim()}>
          {busy ? "正在创建并连接…" : "创建并进入"}
          <ArrowRight size={17} />
        </Button>
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
          <TextArea
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
        <Button className="primary wide" disabled={busy || !value.trim()}>
          {busy ? "正在连接…" : "进入房间"}
          <ArrowRight size={17} />
        </Button>
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
        <TextArea readOnly rows={3} value={invite} />
      </label>
      <Button
        className="primary wide"
        onClick={() =>
          void actions
            .copyText(invite)
            .then(() => setCopied(true))
            .catch(actions.report)
        }
      >
        {copied ? <Check size={17} /> : <Copy size={17} />}{" "}
        {copied ? "已复制，发给朋友吧" : "复制邀请链接"}
      </Button>
      <p className="form-note">
        邀请包含私密加入凭证，请只分享给你信任的朋友。
      </p>
      {app.inviteId && app.room && (
        <Button
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
        </Button>
      )}
    </ModalShell>
  );
}
function SourcePicker() {
  const app = useApp();
  const [selected, setSelected] = useState(
    app.sources.find(
      (s) => s.kind === (window.desktop?.nativeCapture ? "window" : "screen"),
    )?.id ?? "",
  );
  const [audioApplication, setAudioApplication] = useState("");
  const selectedScreen =
    app.sources.find((s) => s.id === selected)?.kind === "screen";
  const audioApplications = [
    ...new Map(
      app.sources
        .filter((s) => s.applicationId)
        .map((s) => [s.applicationId!, s.application!]),
    ).entries(),
  ];
  const [kind, setKind] = useState(
    window.desktop?.nativeCapture ? "window" : "screen",
  );
  return (
    <ModalShell
      title="你想分享哪个画面？"
      subtitle="朋友们只会看到你选择的屏幕或应用窗口。"
      wide
    >
      <div className="source-tabs">
        <Button
          className={kind === "screen" ? "selected" : ""}
          onClick={() => {
            setKind("screen");
            setSelected(app.sources.find((s) => s.kind === "screen")?.id ?? "");
          }}
        >
          <Monitor size={16} />
          整个屏幕
        </Button>
        <Button
          className={kind === "window" ? "selected" : ""}
          onClick={() => {
            setKind("window");
            setSelected(app.sources.find((s) => s.kind === "window")?.id ?? "");
          }}
        >
          <AppWindow size={16} />
          应用窗口
        </Button>
      </div>
      <div className="source-grid">
        {app.sources
          .filter((s) => s.kind === kind)
          .map((source) => (
            <Button
              className={`source-card ${source.id === selected ? "selected" : ""}`}
              key={source.id}
              onClick={() => setSelected(source.id)}
            >
              {source.thumbnail ? (
                <img alt={`${source.name}预览`} src={source.thumbnail} />
              ) : (
                <div className="source-placeholder">
                  {source.kind === "screen" ? (
                    <Monitor size={36} />
                  ) : (
                    <AppWindow size={36} />
                  )}
                  <small>{source.application}</small>
                </div>
              )}
              <span>
                {source.name}
                {source.id === selected && <Check size={15} />}
              </span>
            </Button>
          ))}
      </div>
      <Checkbox
        className="check-label"
        checked={app.systemAudio}
        onChange={(event) => update({ systemAudio: event.target.checked })}
      >
        <span>
          {window.desktop?.nativeCapture
            ? selectedScreen
              ? "共享指定应用的声音"
              : "共享此应用的声音"
            : "共享系统声音"}
          <small>与麦克风独立传输，观看端可单独调节。</small>
        </span>
      </Checkbox>
      {window.desktop?.nativeCapture && selectedScreen && app.systemAudio && (
        <label>
          声音来源应用
          <Select
            aria-label="声音来源应用"
            value={audioApplication || undefined}
            placeholder="请选择应用"
            onChange={setAudioApplication}
            options={audioApplications.map(([value, label]) => ({
              value,
              label,
            }))}
          />
        </label>
      )}
      <p className="form-note">
        {window.desktop?.platform === "darwin"
          ? "macOS 在映聚内选择屏幕或窗口。请保持共享窗口展开，最小化或隐藏可能暂停画面。开启声音后会采集该应用的声音，包括同一应用的其他窗口或标签页；映聚语音不会被采集。首次使用需授予录屏与系统录音权限。"
          : "共享的是系统声音，并非仅此窗口的声音。建议佩戴耳机；Windows 的语音回采隔离仍待实机验证。"}
      </p>
      <Button
        className="primary wide"
        disabled={
          !selected ||
          app.busy ||
          Boolean(
            window.desktop?.nativeCapture &&
              selectedScreen &&
              app.systemAudio &&
              !audioApplication,
          )
        }
        onClick={() =>
          void actions.run(() =>
            actions.chooseSource({
              sourceId: selected,
              systemAudio: app.systemAudio,
              ...(window.desktop?.nativeCapture &&
              selectedScreen &&
              app.systemAudio
                ? { audioApplication }
                : {}),
            }),
          )
        }
      >
        <Monitor size={17} />
        确认共享
      </Button>
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
      <Button
        className="id-copy"
        onClick={() =>
          void actions
            .copyText(user.id, "你的用户 ID 已复制")
            .catch(actions.report)
        }
      >
        <span>
          我的用户 ID<small>{user.id}</small>
        </span>
        <Copy size={16} />
      </Button>
      <form className="inline-form" onSubmit={submit}>
        <Input
          aria-label="好友用户 ID"
          placeholder="粘贴朋友的完整用户 ID"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          required
        />
        <Button className="primary" aria-label="发送好友请求">
          <UserPlus size={17} />
        </Button>
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
              <Button
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
              </Button>
            )}
            <Button
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
            </Button>
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
        <Button
          className="secondary"
          onClick={() => void refresh().catch(actions.report)}
        >
          <RefreshCw size={16} />
          刷新
        </Button>
        <Button
          className="primary"
          onClick={() => void exportData().catch(actions.report)}
        >
          <Download size={16} />
          导出诊断
        </Button>
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
        <Input
          aria-label="要封禁的用户 ID"
          placeholder="输入完整用户 ID"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          required
        />
        <Button className="primary" aria-label="封禁成员">
          <Shield size={17} />
        </Button>
      </form>
      <div className="friends-list">
        {!items.length && <p className="empty-list">没有被禁止加入的成员。</p>}
        {items.map((member) => (
          <div className="friend" key={member.userId}>
            <div className="avatar amber">{member.displayName[0]}</div>
            <span>{member.displayName}</span>
            <Button
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
            </Button>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}
