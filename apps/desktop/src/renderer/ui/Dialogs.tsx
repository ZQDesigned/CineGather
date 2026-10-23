import {
  Select,
  Checkbox,
  Form,
  Radio,
  Card,
  Tabs,
  Empty,
  Avatar,
  Tooltip,
  Typography,
  Alert,
  Collapse,
  Statistic,
  Space,
  Spin,
} from "antd";
import { Button, TextArea, Input } from "./Controls";
import { Settings } from "./Settings";
import { useEffect, useState } from "react";
import {
  Copy,
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
import { useSourcePreviews } from "./useSourcePreviews";
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
  const busy = useApp((s) => s.busy);
  return (
    <ModalShell
      title="创建私人房间"
      subtitle="给今晚的相聚，取个好名字。"
      footer={
        <>
          <Button onClick={() => update({ modal: null })}>取消</Button>
          <Button
            type="primary"
            htmlType="submit"
            form="create-room"
            loading={busy}
          >
            创建并进入
          </Button>
        </>
      }
    >
      <Form
        id="create-room"
        layout="vertical"
        initialValues={{ name: "今晚一起看", max: 5 }}
        onFinish={({ name, max }: { name: string; max: number }) =>
          void actions.run(() => actions.createRoom(name.trim(), max))
        }
      >
        <Form.Item
          name="name"
          label="房间名称"
          rules={[
            { required: true, whitespace: true, message: "请输入房间名称" },
          ]}
        >
          <Input autoFocus maxLength={64} showCount />
        </Form.Item>
        <Form.Item name="max" label="房间人数">
          <Select
            options={Array.from({ length: 9 }, (_, i) => ({
              value: i + 2,
              label: `${i + 2} 人${i + 2 === 5 ? "（默认）" : ""}`,
            }))}
          />
        </Form.Item>
        <p className="form-note">
          <Shield size={16} />
          只有受邀朋友可以加入，默认不录制。
        </p>
      </Form>
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
      footer={
        <>
          <Button onClick={() => update({ modal: null })}>取消</Button>
          <Button
            type="primary"
            htmlType="submit"
            form="join-room"
            loading={busy}
          >
            进入房间
          </Button>
        </>
      }
    >
      <Form
        id="join-room"
        layout="vertical"
        initialValues={{ invite: value }}
        onValuesChange={(_, values: { invite: string }) =>
          update({ joinValue: values.invite })
        }
        onFinish={({ invite }: { invite: string }) =>
          void actions.run(() => actions.joinRoom(invite))
        }
      >
        <Form.Item
          label="邀请链接或完整房间码"
          name="invite"
          rules={[
            {
              required: true,
              whitespace: true,
              message: "请粘贴邀请链接或完整房间码",
            },
          ]}
        >
          <TextArea
            autoFocus
            rows={3}
            placeholder="cinegather://join?room=…&invite=…"
          />
        </Form.Item>
        <p className="form-note">
          完整房间码格式：房间 UUID / 邀请 token。已加入的房间可直接使用完整
          UUID。
        </p>
      </Form>
    </ModalShell>
  );
}
function Invite() {
  const app = useApp();
  const invite = app.invite ?? "";

  return (
    <ModalShell
      title="好座位，留给好朋友"
      subtitle="邀请在 24 小时内有效，最多可供 10 位新成员使用。"
    >
      <Form layout="vertical">
        <Form.Item label="房间邀请">
          <TextArea aria-label="房间邀请" readOnly rows={3} value={invite} />
        </Form.Item>
      </Form>
      <Button
        type="primary"
        block
        onClick={() =>
          void actions
            .copyText(invite)

            .catch(actions.report)
        }
      >
        <Copy size={17} />
        复制邀请链接
      </Button>
      <Alert
        type="info"
        showIcon
        title="邀请包含私密加入凭证，请只分享给你信任的朋友。"
        className="invite-note"
      />
      {app.inviteId && app.room && (
        <Button
          type="text"
          danger
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
  const native = Boolean(window.desktop?.nativeCapture);
  const [kind, setKind] = useState(native ? "window" : "screen");
  const previews = useSourcePreviews(app.sources, kind);
  const [selected, setSelected] = useState(
    app.sources.find((s) => s.kind === (native ? "window" : "screen"))?.id ??
      "",
  );
  const selectedScreen =
    app.sources.find((s) => s.id === selected)?.kind === "screen";
  const choose = () =>
    void actions.run(() =>
      actions.chooseSource({
        sourceId: selected,
        systemAudio: app.systemAudio,
      }),
    );
  const sources = (category: string) => {
    const items = app.sources.filter((s) => s.kind === category);
    return items.length ? (
      <Radio.Group
        aria-label="共享来源"
        name="capture-source"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="source-grid"
      >
        {items.map((source) => (
          <Radio
            key={source.id}
            value={source.id}
            className="source-card"
            aria-label={source.name}
          >
            <Card
              size="small"
              className="source-option"
              cover={
                <div className="source-preview">
                  {source.thumbnail || previews.images[source.id] ? (
                    <img
                      alt=""
                      src={source.thumbnail || previews.images[source.id]}
                    />
                  ) : previews.enabled ? (
                    <div className="source-placeholder" role="status">
                      {previews.images[source.id] === undefined ? (
                        <>
                          <Spin size="small" />
                          <small>正在获取预览</small>
                        </>
                      ) : (
                        <small>预览不可用，请展开窗口后刷新</small>
                      )}
                    </div>
                  ) : (
                    <div className="source-placeholder">
                      {source.kind === "screen" ? (
                        <Monitor size={38} />
                      ) : (
                        <AppWindow size={38} />
                      )}
                      <small>{source.application}</small>
                    </div>
                  )}
                </div>
              }
            >
              <div className="source-name" title={source.name}>
                {source.name}
              </div>
            </Card>
          </Radio>
        ))}
      </Radio.Group>
    ) : (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          category === "window"
            ? "没有可共享的应用窗口，请先打开并展开窗口。"
            : "没有可用的屏幕。"
        }
      />
    );
  };
  return (
    <ModalShell
      title="你想分享哪个画面？"
      wide
      footer={
        <>
          <Button onClick={() => void actions.chooseSource()}>取消</Button>
          <Button
            type="primary"
            icon={<Monitor size={17} />}
            disabled={!selected || app.busy}
            onClick={choose}
          >
            确认共享
          </Button>
        </>
      }
    >
      <Tabs
        className="capture-tabs"
        tabBarExtraContent={
          previews.enabled ? (
            <Button
              type="text"
              size="small"
              icon={<RefreshCw size={14} />}
              onClick={previews.refresh}
            >
              刷新预览
            </Button>
          ) : undefined
        }
        activeKey={kind}
        onChange={(value) => {
          setKind(value);
          setSelected(app.sources.find((s) => s.kind === value)?.id ?? "");
        }}
        items={[
          {
            key: "screen",
            label: "整个屏幕",
            icon: <Monitor size={16} />,
            children: sources("screen"),
          },
          {
            key: "window",
            label: "应用窗口",
            icon: <AppWindow size={16} />,
            children: sources("window"),
          },
        ]}
      />
      <div className="capture-audio">
        <Checkbox
          checked={app.systemAudio}
          onChange={(e) => update({ systemAudio: e.target.checked })}
        >
          {native
            ? selectedScreen
              ? "共享系统声音（排除映聚）"
              : "共享此应用的声音"
            : "共享系统声音"}
        </Checkbox>
      </div>
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
  const submit = () => {
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
      <Card size="small" className="identity-card">
        <Space direction="vertical" size={4}>
          <Typography.Text type="secondary">我的用户 ID</Typography.Text>
          <Typography.Text code>{user.id}</Typography.Text>
        </Space>
        <Tooltip title="复制用户 ID">
          <Button
            type="text"
            aria-label="复制我的用户 ID"
            icon={<Copy size={16} />}
            onClick={() =>
              void actions
                .copyText(user.id, "你的用户 ID 已复制")
                .catch(actions.report)
            }
          />
        </Tooltip>
      </Card>
      <Form layout="vertical" onFinish={submit}>
        <Form.Item label="好友用户 ID" required>
          <Space.Compact block>
            <Input
              aria-label="好友用户 ID"
              placeholder="粘贴朋友的完整用户 ID"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              required
            />
            <Button
              type="primary"
              htmlType="submit"
              icon={<UserPlus size={16} />}
            >
              发送好友请求
            </Button>
          </Space.Compact>
        </Form.Item>
      </Form>
      <div className="friends-list">
        {!items.length && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无好友，可以在房间里向成员发送好友请求。"
          />
        )}
        {items.map((friend) => (
          <div className="friend" key={friend.userId}>
            <Avatar className="amber">{friend.displayName[0]}</Avatar>
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
            <Tooltip title="移除关系">
              <Button
                type="text"
                danger
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
            </Tooltip>
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
        <Card size="small">
          <Statistic
            title="媒体状态"
            value={
              (
                {
                  connected: "已连接",
                  disconnected: "未连接",
                  reconnecting: "重新连接中",
                  connecting: "连接中",
                } as Record<string, string>
              )[String(data.state)] ?? "未连接"
            }
          />
        </Card>
        <Card size="small">
          <Statistic
            title="服务器活跃房间"
            value={server?.activeRooms ?? "—"}
          />
        </Card>
        <Card size="small">
          <Statistic
            title="API 请求 / 错误"
            value={server ? `${server.requests} / ${server.errors}` : "—"}
          />
        </Card>
      </div>
      <Collapse
        items={[
          {
            key: "details",
            label: "查看详细诊断数据",
            children: (
              <pre className="diagnostic-json">
                {JSON.stringify(data, null, 2)}
              </pre>
            ),
          },
        ]}
      />
      <p className="form-note">
        RTT、丢包、帧率等指标在轨道传输后可见。WebRTC RTT
        不等同于端到端音画延迟。
      </p>
      <div className="dialog-actions">
        <Button onClick={() => void refresh().catch(actions.report)}>
          <RefreshCw size={16} />
          刷新
        </Button>
        <Button
          type="primary"
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
      <Form
        layout="vertical"
        onFinish={() => {
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
        <Form.Item label="要封禁的用户 ID" required>
          <Space.Compact block>
            <Input
              aria-label="要封禁的用户 ID"
              placeholder="输入完整用户 ID"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              required
            />
            <Button danger htmlType="submit" icon={<Shield size={16} />}>
              封禁成员
            </Button>
          </Space.Compact>
        </Form.Item>
      </Form>
      <div className="friends-list">
        {!items.length && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="没有被禁止加入的成员。"
          />
        )}
        {items.map((member) => (
          <div className="friend" key={member.userId}>
            <Avatar className="amber">{member.displayName[0]}</Avatar>
            <span>{member.displayName}</span>
            <Button
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
