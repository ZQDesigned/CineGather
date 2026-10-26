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
  Space,
  Spin,
} from "antd";
import { Button, TextArea, Input } from "./Controls";
import { Settings } from "./Settings";
import { ClientDownload } from "./ClientDownload";
import { FriendSearch } from "./FriendSearch";
import { UpdateDialog } from "./Updates";
import { RoomSettings } from "./RoomSettings";
import { Diagnostics } from "./Diagnostics";
import { useEffect, useState } from "react";
import { Copy, Monitor, AppWindow, RefreshCw, Shield, X } from "lucide-react";
import { useApp, update, type Modal } from "../store";
import * as actions from "../controller";
import { unwrap } from "@cinegather/api-client";
import { parseInvitation } from "@cinegather/client-core";
import { DialogLifecycle, ModalShell, useDialogOpen } from "./Modal";
import { useSourcePreviews } from "./useSourcePreviews";
import { capabilities } from "../platform";
import {
  deviceAudioTitle,
  deviceAudioDescription,
} from "../audio-compatibility";
export function Dialogs() {
  const modal = useApp((s) => s.modal);
  const [shown, setShown] = useState<Modal>(modal);
  useEffect(() => {
    if (!shown && modal) setShown(modal);
  }, [modal, shown]);
  if (!shown) return null;
  return (
    <DialogLifecycle.Provider
      value={{
        open: modal === shown,
        afterClose: () => {
          const next = useApp.getState().modal;
          if (next !== shown) setShown(next);
        },
      }}
    >
      <DialogContent key={shown} modal={shown} />
    </DialogLifecycle.Provider>
  );
}
function DialogContent({ modal }: { modal: Modal }) {
  if (modal === "share-unavailable")
    return (
      <ModalShell
        title="屏幕共享暂不可用"
        footer={
          <Button type="primary" onClick={() => update({ modal: null })}>
            知道了
          </Button>
        }
      >
        <p>当前账号暂未开通屏幕共享能力。</p>
      </ModalShell>
    );
  if (modal === "room-settings") return <RoomSettings />;
  if (modal === "create") return <CreateRoom />;
  if (modal === "join") return <JoinRoom />;
  if (modal === "settings") return <Settings />;
  if (modal === "download" && !capabilities().desktop)
    return <ClientDownload />;
  if (modal === "updates") return <UpdateDialog />;
  if (modal === "invite") return <Invite />;
  if (modal === "source") return <SourcePicker />;
  if (modal === "friends") return <Friends />;
  if (modal === "diagnostics") return <Diagnostics />;
  if (modal === "bans") return <Bans />;
  return null;
}
function CreateRoom() {
  const busy = useApp((s) => s.busy);
  const [form] = Form.useForm();
  const access = Form.useWatch("access", form);
  return (
    <ModalShell
      title="创建私人房间"
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
        form={form}
        layout="vertical"
        initialValues={{ name: "今晚一起看", max: 5, access: "normal" }}
        onFinish={({
          name,
          max,
          access,
          password,
        }: {
          name: string;
          max: number;
          access: "normal" | "password";
          password?: string;
        }) =>
          void actions.run(() =>
            actions.createRoom(name.trim(), max, access, password),
          )
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
        <Form.Item name="access" label="房间类型">
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            options={[
              { value: "normal", label: "普通房" },
              { value: "password", label: "加密房" },
            ]}
          />
        </Form.Item>
        {access === "password" && (
          <Form.Item
            name="password"
            label="房间密码"
            preserve={false}
            rules={[
              { required: true, whitespace: true, message: "请设置房间密码" },
              { min: 4, max: 64, message: "密码需为 4–64 个字符" },
            ]}
          >
            <Input.Password
              maxLength={64}
              autoComplete="new-password"
              placeholder="设置 4–64 位密码"
            />
          </Form.Item>
        )}
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
      footer={
        <>
          <Button onClick={() => update({ modal: null })}>取消</Button>
          <Button
            type="primary"
            htmlType="submit"
            form="join-room"
            aria-label="进入房间"
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
        onFinish={({
          invite,
          password,
        }: {
          invite: string;
          password?: string;
        }) => void actions.run(() => actions.joinRoom(invite, password))}
      >
        <Form.Item
          label="房间号或邀请链接"
          name="invite"
          rules={[
            {
              required: true,
              whitespace: true,
              message: "请输入房间号或邀请链接",
            },
          ]}
        >
          <Input autoFocus placeholder="输入 8 位房间号或粘贴邀请链接" />
        </Form.Item>
        {!parseInvitation(value).inviteToken && (
          <Form.Item
            name="password"
            label="房间密码（加密房必填）"
            preserve={false}
          >
            <Input.Password
              maxLength={64}
              autoComplete="off"
              placeholder="普通房可留空"
            />
          </Form.Item>
        )}
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
          void actions.copyText(invite, "邀请链接已复制").catch(actions.report)
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
  const open = useDialogOpen();
  const app = useApp();
  const native = Boolean(window.desktop?.nativeCapture);
  const browser = !capabilities().sourcePicker;
  const [picking, setPicking] = useState(false);
  const [kind, setKind] = useState(native ? "window" : "screen");
  const previews = useSourcePreviews(app.sources, kind, open);
  const [selected, setSelected] = useState(
    app.sources.find((s) => s.kind === (native ? "window" : "screen"))?.id ??
      "",
  );
  const selectedScreen =
    app.sources.find((s) => s.id === selected)?.kind === "screen";
  const deviceAudio =
    window.desktop?.platform === "win32" &&
    app.sources.find((s) => s.id === selected)?.audioIsolationSupported ===
      false;
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
      title={app.switchingSource ? "切换共享画面" : "你想分享哪个画面？"}
      wide
      footer={
        <>
          <Button onClick={() => void actions.chooseSource()}>取消</Button>
          <Button
            type="primary"
            icon={<Monitor size={17} />}
            disabled={
              browser ? !capabilities().displayCapture : !selected || app.busy
            }
            loading={browser && picking}
            onClick={
              browser
                ? () => {
                    setPicking(true);
                    void actions
                      .chooseBrowserSource()
                      .finally(() => setPicking(false));
                  }
                : choose
            }
          >
            {app.switchingSource
              ? "确认切换"
              : browser
                ? "选择并共享"
                : "确认共享"}
          </Button>
        </>
      }
    >
      {browser ? (
        <Alert
          type={capabilities().displayCapture ? "info" : "warning"}
          showIcon
          title={
            capabilities().displayCapture
              ? "在 Chrome 中选择屏幕、窗口或标签页"
              : "当前地址无法共享画面，请使用 HTTPS 或本机地址打开"
          }
          description={
            capabilities().displayCapture
              ? "共享标签页时，可在 Chrome 选择器中开启声音。"
              : undefined
          }
        />
      ) : (
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
      )}
      <div className="capture-audio">
        <Checkbox
          checked={app.systemAudio}
          disabled={app.switchingSource}
          onChange={(e) => update({ systemAudio: e.target.checked })}
        >
          {deviceAudio
            ? "共享设备声音（兼容模式）"
            : native || window.desktop?.platform === "win32"
              ? selectedScreen
                ? "共享系统声音（排除映聚）"
                : "共享此应用的声音"
              : browser
                ? "共享声音"
                : "共享系统声音"}
        </Checkbox>
        {deviceAudio && app.systemAudio && (
          <Alert
            className="capture-audio-compatibility"
            type="warning"
            showIcon
            title={deviceAudioTitle}
            description={deviceAudioDescription}
          />
        )}
      </div>
    </ModalShell>
  );
}
function Friends() {
  const [user] = useState(() => useApp.getState().user!);
  const items = useApp((app) => app.friends);
  const visibility = useApp((app) => app.presenceVisibility);
  const load = actions.refreshFriends;
  useEffect(() => {
    void load().catch(actions.report);
  }, []);
  return (
    <ModalShell title="朋友们" subtitle="把熟悉的名字，留在身边。">
      <Card size="small" className="identity-card">
        <Space direction="vertical" size={4}>
          <Typography.Text type="secondary">我的用户名</Typography.Text>
          <Typography.Text strong>{user.username}</Typography.Text>
        </Space>
      </Card>
      <Form layout="vertical">
        <Form.Item label="我的在线状态">
          <Select
            aria-label="我的在线状态"
            value={visibility}
            placeholder="正在连接"
            options={[
              { value: "online", label: "在线" },
              { value: "invisible", label: "隐身（好友看到离线）" },
            ]}
            onChange={(value: "online" | "invisible") =>
              void actions.run(() => actions.setPresence(value))
            }
          />
        </Form.Item>
      </Form>
      <FriendSearch />
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
                  ? friend.online
                    ? "在线"
                    : "离线"
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
function Bans() {
  const [room] = useState(() => useApp.getState().room!);
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
