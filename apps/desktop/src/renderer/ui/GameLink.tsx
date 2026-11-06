import { useRetainedDialog } from "./useRetainedDialog";
import {
  App,
  Alert,
  Avatar,
  Badge,
  Button,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
} from "antd";
import {
  Gamepad2,
  Plus,
  LogIn,
  Copy,
  RefreshCw,
  Users,
  UserPlus,
  X,
  Monitor,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import styled from "@emotion/styled";
import { unwrap } from "@cinegather/api-client";
import {
  gameTitles,
  type GameKind,
  type GameWorld,
} from "@cinegather/contracts";
import { gameLink } from "../game-link";
import { useApp, update } from "../store";
import * as actions from "../controller";
import { friendDisplayName } from "../friends";
import { clientNotificationEnabled } from "../client-notifications";
const Surface = styled.section`
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 24px 28px;
  .game-heading,
  .game-panel-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  h1 {
    font-size: 24px;
    margin: 0;
  }
  h2 {
    font-size: 20px;
    margin: 0;
  }
  h3 {
    font-size: 15px;
    margin: 0;
  }
  .game-heading > div:first-child,
  .game-panel-heading > div:first-child {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }
  .game-panels {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(260px, 1fr);
    gap: 20px;
    align-items: start;
  }
  .game-panel {
    border: 1px solid var(--border, #2c2e3a);
    background: var(--panel, #191b24);
    border-radius: 16px;
    padding: 24px;
    margin-bottom: 20px;
    min-width: 0;
  }
  .game-empty {
    padding: 64px 20px;
    text-align: center;
    border: 1px dashed var(--border, #2c2e3a);
    border-radius: 16px;
  }
  .game-empty > svg {
    color: var(--purple);
    margin-bottom: 20px;
  }
  .game-empty h2 {
    margin-bottom: 12px;
  }
  .game-empty p {
    color: var(--muted, #9397a8);
    line-height: 1.8;
    margin-bottom: 24px;
  }
  .game-facts {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin: 20px 0;
  }
  .game-fact {
    padding: 16px 18px;
    border-radius: 12px;
    background: var(--canvas, #111219);
    flex: 1;
    min-width: 180px;
  }
  .game-fact small {
    display: block;
    color: var(--muted, #9397a8);
    margin-bottom: 8px;
  }
  .game-fact strong {
    font-size: 22px;
    letter-spacing: 1px;
    font-variant-numeric: tabular-nums;
  }
  .game-help {
    color: var(--muted, #9397a8);
    line-height: 1.8;
  }
  .game-panel .ant-list-item-meta {
    align-items: center;
  }
  .game-panel .ant-list-item-meta-content {
    min-width: 0;
  }
  .game-panel .ant-list-item-action {
    flex-shrink: 0;
  }
  .game-panel .ant-list-item-meta-title {
    overflow-wrap: anywhere;
  }
  @media (max-width: 1100px) {
    padding: 16px;
    .game-panels {
      grid-template-columns: 1fr;
    }
    .game-panel {
      padding: 20px;
    }
  }
`;
const sessionPath = (sessionId: string) => ({ path: { sessionId } });
async function decide(id: string, approve: boolean) {
  unwrap(
    await actions.api.POST("/api/v1/games/requests/{requestId}/decision", {
      params: { path: { requestId: id } },
      body: { approve },
    }),
  );
  await gameLink.refresh();
}
async function accept(id: string) {
  unwrap(
    await actions.api.POST("/api/v1/games/invitations/{inviteId}/accept", {
      params: { path: { inviteId: id } },
    }),
  );
  await gameLink.refresh();
  location.hash = "/games";
}
async function dismiss(id: string) {
  unwrap(
    await actions.api.DELETE("/api/v1/games/invitations/{inviteId}", {
      params: { path: { inviteId: id } },
    }),
  );
  await gameLink.refresh();
}
export function GameLink() {
  const { game, user, friends, busy } = useApp(),
    { snapshot, local } = game,
    { session, self } = snapshot;
  const bridge = window.desktop?.gameLink,
    host = self?.role === "host";
  const [dialog, setDialog] = useState<
      "create" | "join" | "invite" | "resume" | null
    >(null),
    [worlds, setWorlds] = useState<GameWorld[]>([]),
    [selectedGame, setSelectedGame] = useState<GameKind>("minecraft-java"),
    [scanning, setScanning] = useState(false),
    [worldPort, setWorldPort] = useState<number>(),
    [name, setName] = useState("一起探索世界"),
    [code, setCode] = useState(""),
    [found, setFound] = useState<{
      id: string;
      name: string;
      hostName: string;
      maxMembers: number;
      memberCount: number;
      gameVersion: string | null;
    }>(),
    [sent, setSent] = useState<Set<string>>(new Set());
  const retainedDialog = useRetainedDialog(dialog ?? undefined);
  const shownDialog = retainedDialog.value;
  const dialogEpoch = useRef(0);
  useEffect(() => {
    if (!host && (dialog === "invite" || dialog === "resume")) {
      dialogEpoch.current++;
      setDialog(null);
    }
  }, [host, dialog]);
  useEffect(() => {
    void gameLink.refresh();
    void actions.refreshFriends().catch(() => {});
  }, []);
  const close = () => {
    dialogEpoch.current++;
    setDialog(null);
  };
  const scan = async (game: GameKind = selectedGame) => {
    if (!bridge) return;
    const epoch = ++dialogEpoch.current;
    setScanning(true);
    try {
      const result = (await bridge.discover(game)).filter(
        (world) => (world.game ?? "minecraft-java") === game,
      );
      if (epoch !== dialogEpoch.current) return;
      setWorlds(result);
      setWorldPort((previous) =>
        result.length === 1
          ? result[0]!.port
          : result.some((world) => world.port === previous)
            ? previous
            : undefined,
      );
    } catch (error) {
      if (epoch === dialogEpoch.current) {
        setWorlds([]);
        setWorldPort(undefined);
        actions.report(error);
      }
    } finally {
      if (epoch === dialogEpoch.current) setScanning(false);
    }
  };
  const chooseWorld = (kind: "create" | "resume") => {
    const selected =
      kind === "resume" ? (session?.game ?? "minecraft-java") : selectedGame;
    setSelectedGame(selected);
    setWorlds([]);
    setWorldPort(undefined);
    setDialog(kind);
    void scan(selected);
  };
  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    update({ notice: "已复制" });
  };
  const request = async () => {
    if (!found) return;
    unwrap(
      await actions.api.POST("/api/v1/games/{sessionId}/requests", {
        params: sessionPath(found.id),
      }),
    );
    close();
    await gameLink.refresh();
    update({ notice: "申请已发送，等待对方同意" });
  };
  const invite = async (userId: string) => {
    if (!session) return;
    unwrap(
      await actions.api.POST("/api/v1/games/{sessionId}/invitations", {
        params: sessionPath(session.id),
        body: { userId },
      }),
    );
    setSent((prev) => new Set([...prev, userId]));
    update({ notice: "联机邀请已发送" });
  };
  const accepted = friends.filter((f) => f.status === "accepted"),
    requests = snapshot.requests.filter((r) => r.status === "pending");
  return (
    <Surface>
      <div className="game-heading">
        <div>
          <Gamepad2 size={25} />
          <h1>游戏联机</h1>
        </div>
        <Space wrap>
          <Button
            icon={<RefreshCw size={16} />}
            loading={game.syncing}
            onClick={() => void gameLink.refresh()}
          >
            刷新
          </Button>
          {!session && bridge && (
            <>
              <Button
                icon={<LogIn size={16} />}
                onClick={() => {
                  setCode("");
                  setFound(undefined);
                  setDialog("join");
                }}
              >
                加入联机
              </Button>
              <Button
                type="primary"
                icon={<Plus size={16} />}
                disabled={!user?.gameHostEnabled}
                onClick={() => chooseWorld("create")}
              >
                发起联机
              </Button>
            </>
          )}
        </Space>
      </div>
      {!bridge ? (
        <div className="game-panel">
          <Empty
            image={<Monitor size={50} />}
            description="游戏联机需要 Windows 或 macOS 桌面客户端"
          />
          <div style={{ textAlign: "center" }}>
            <Button
              type="primary"
              onClick={() => update({ modal: "download" })}
            >
              下载客户端
            </Button>
          </div>
        </div>
      ) : (
        <>
          {game.error && (
            <Alert
              type="warning"
              title={game.error}
              showIcon
              style={{ marginBottom: 20 }}
            />
          )}
          {session ? (
            <div className="game-panels">
              <div>
                <div className="game-panel">
                  <div className="game-panel-heading">
                    <div>
                      <h2>{session.name}</h2>
                      <Tag>{gameTitles[session.game]}</Tag>
                    </div>
                    <Badge
                      status={
                        local.state === "connected"
                          ? "success"
                          : local.state === "failed"
                            ? "error"
                            : "processing"
                      }
                      text={
                        self
                          ? host
                            ? local.state === "connected"
                              ? "已发起联机"
                              : "连接未就绪"
                            : local.state === "connected"
                              ? "连接已就绪"
                              : "正在连接"
                          : "已在另一台设备加入"
                      }
                    />
                  </div>
                  <Space wrap>
                    <Users size={16} />
                    <span>
                      {session.memberCount} / {session.maxMembers} 人
                    </span>
                    {session.gameVersion && <Tag>{session.gameVersion}</Tag>}
                    {local.route && (
                      <Tag>{local.route === "p2p" ? "直连" : "中转"}</Tag>
                    )}
                  </Space>
                  <div className="game-facts">
                    <div className="game-fact">
                      <small>联机码</small>
                      <Space>
                        <strong>{session.code}</strong>
                        <Button
                          type="text"
                          aria-label="复制联机码"
                          icon={<Copy size={16} />}
                          onClick={() =>
                            void actions.run(() => copy(session.code))
                          }
                        />
                      </Space>
                    </div>
                    {!host && self && (
                      <div className="game-fact">
                        <small>
                          {session.game === "stardew-valley"
                            ? "在游戏「加入局域网游戏」中输入 IP"
                            : "在游戏「直接连接」中输入"}
                        </small>
                        {local.address ? (
                          <Space wrap>
                            <strong>
                              {session.game === "stardew-valley"
                                ? "127.0.0.1"
                                : local.address}
                            </strong>
                            <Button
                              aria-label="复制连接地址"
                              icon={<Copy size={16} />}
                              onClick={() =>
                                void actions.run(() =>
                                  copy(
                                    session?.game === "stardew-valley"
                                      ? "127.0.0.1"
                                      : local.address!,
                                  ),
                                )
                              }
                            />
                          </Space>
                        ) : (
                          <span>正在准备本机连接地址…</span>
                        )}
                      </div>
                    )}
                  </div>
                  {local.message && (
                    <p className="game-help">{local.message}</p>
                  )}
                  {!self && (
                    <p className="game-help">
                      此账号的联机正在另一台设备运行，请在那台设备上退出后再加入。
                    </p>
                  )}
                  {self && (
                    <Space wrap>
                      {host && (
                        <>
                          <Button
                            type="primary"
                            icon={<UserPlus size={16} />}
                            onClick={() => {
                              setSent(new Set());
                              setDialog("invite");
                            }}
                          >
                            邀请好友
                          </Button>
                          {local.state !== "connected" && (
                            <Button onClick={() => chooseWorld("resume")}>
                              选择世界并恢复
                            </Button>
                          )}
                        </>
                      )}
                      <Popconfirm
                        title={
                          host ? "结束此次游戏联机？" : "退出此次游戏联机？"
                        }
                        description={
                          host
                            ? "所有玩家的联机连接将断开。"
                            : "游戏连接将断开，房间语音会继续保持。"
                        }
                        onConfirm={() => actions.run(() => gameLink.exit())}
                      >
                        <Button danger disabled={busy}>
                          {host ? "结束联机" : "退出联机"}
                        </Button>
                      </Popconfirm>
                    </Space>
                  )}
                </div>
                {host && requests.length > 0 && (
                  <div className="game-panel">
                    <h3>
                      加入申请 <Badge count={requests.length} />
                    </h3>
                    <List
                      dataSource={requests}
                      renderItem={(r) => (
                        <List.Item
                          actions={[
                            <Button
                              key="reject"
                              disabled={busy}
                              onClick={() =>
                                void actions.run(() => decide(r.id, false))
                              }
                            >
                              拒绝
                            </Button>,
                            <Button
                              key="approve"
                              type="primary"
                              disabled={busy || session.memberCount >= 8}
                              onClick={() =>
                                void actions.run(() => decide(r.id, true))
                              }
                            >
                              同意
                            </Button>,
                          ]}
                        >
                          <List.Item.Meta
                            avatar={
                              <Avatar>{r.displayName.slice(0, 1)}</Avatar>
                            }
                            title={r.displayName}
                          />
                        </List.Item>
                      )}
                    />
                  </div>
                )}
              </div>
              <div className="game-panel">
                <h3>联机成员</h3>
                <List
                  dataSource={snapshot.members}
                  renderItem={(member) => (
                    <List.Item
                      actions={
                        host && member.id !== self?.memberId
                          ? [
                              <Popconfirm
                                key="remove"
                                title={`移除 ${member.displayName}？`}
                                onConfirm={() =>
                                  actions.run(async () => {
                                    unwrap(
                                      await actions.api.DELETE(
                                        "/api/v1/games/{sessionId}/members/{memberId}",
                                        {
                                          params: {
                                            path: {
                                              sessionId: session.id,
                                              memberId: member.id,
                                            },
                                          },
                                        },
                                      ),
                                    );
                                    await gameLink.refresh();
                                  })
                                }
                              >
                                <Button
                                  type="text"
                                  danger
                                  aria-label={`移除${member.displayName}`}
                                  icon={<X size={16} />}
                                />
                              </Popconfirm>,
                            ]
                          : []
                      }
                    >
                      <List.Item.Meta
                        avatar={
                          <Avatar>{member.displayName.slice(0, 1)}</Avatar>
                        }
                        title={
                          <Space wrap>
                            {member.displayName}
                            {member.userId === user?.id && <Tag>你</Tag>}
                          </Space>
                        }
                        description={
                          member.role === "host"
                            ? "主机"
                            : member.status === "reconnecting"
                              ? "正在重连"
                              : "玩家"
                        }
                      />
                    </List.Item>
                  )}
                />
              </div>
            </div>
          ) : (
            <div className="game-empty">
              <Gamepad2 size={52} />
              <h2>和好友连接同一个世界</h2>
              {!user?.gameHostEnabled && (
                <p>当前账号可通过联机码或好友邀请加入游戏。</p>
              )}
              <Button
                icon={<LogIn size={16} />}
                onClick={() => {
                  setFound(undefined);
                  setCode("");
                  setDialog("join");
                }}
              >
                输入联机码
              </Button>
            </div>
          )}
          {!session && requests.length > 0 && (
            <div className="game-panel" style={{ marginTop: 20 }}>
              <h3>等待同意</h3>
              <List
                dataSource={requests}
                renderItem={(r) => (
                  <List.Item
                    actions={[
                      <Button
                        key="cancel"
                        disabled={busy}
                        onClick={() =>
                          void actions.run(async () => {
                            unwrap(
                              await actions.api.DELETE(
                                "/api/v1/games/requests/{requestId}",
                                { params: { path: { requestId: r.id } } },
                              ),
                            );
                            await gameLink.refresh();
                          })
                        }
                      >
                        取消申请
                      </Button>,
                    ]}
                  >
                    <List.Item.Meta
                      title={r.sessionName}
                      description="对方同意后将自动建立联机连接"
                    />
                  </List.Item>
                )}
              />
            </div>
          )}
        </>
      )}
      {snapshot.invitations.length > 0 && (
        <div className="game-panel" style={{ marginTop: 20 }}>
          <h3>好友邀请</h3>
          <List
            dataSource={snapshot.invitations}
            renderItem={(i) => (
              <List.Item
                actions={[
                  <Button
                    key="dismiss"
                    disabled={busy}
                    onClick={() => void actions.run(() => dismiss(i.id))}
                  >
                    婉拒
                  </Button>,
                  <Button
                    key="accept"
                    type="primary"
                    disabled={busy || !bridge || !!session}
                    onClick={() => void actions.run(() => accept(i.id))}
                  >
                    加入联机
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  title={i.sessionName}
                  description={`${i.hostName} 邀请你一起游戏`}
                />
              </List.Item>
            )}
          />
        </div>
      )}
      <Modal
        open={
          retainedDialog.open &&
          (shownDialog === "create" || shownDialog === "resume")
        }
        title={shownDialog === "resume" ? "选择本机世界" : "发起游戏联机"}
        className="cinema-dialog"
        centered
        afterClose={retainedDialog.afterClose}
        destroyOnHidden
        onCancel={close}
        okText={shownDialog === "resume" ? "恢复联机" : "发起联机"}
        confirmLoading={busy}
        okButtonProps={{
          disabled:
            scanning || !worlds.some((world) => world.port === worldPort),
        }}
        onOk={() =>
          void actions.run(async () => {
            if (
              scanning ||
              !worldPort ||
              !worlds.some((world) => world.port === worldPort)
            )
              return;
            if (dialog === "resume") await gameLink.resumeHost(worldPort);
            else
              await gameLink.create(
                name.trim() || "一起探索世界",
                worldPort,
                selectedGame,
              );
            close();
          })
        }
      >
        <Form layout="vertical">
          {shownDialog === "create" && (
            <>
              <Form.Item label="选择游戏" htmlFor="game-link-game">
                <Select
                  id="game-link-game"
                  value={selectedGame}
                  onChange={(value: GameKind) => {
                    setSelectedGame(value);
                    setWorlds([]);
                    setWorldPort(undefined);
                    void scan(value);
                  }}
                  options={Object.entries(gameTitles).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </Form.Item>
              <Form.Item label="联机名称">
                <Input
                  maxLength={64}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Form.Item>
            </>
          )}
          <Form.Item
            label={
              <Space>
                本机世界
                <Button
                  aria-label="重新发现"
                  type="text"
                  size="small"
                  loading={scanning}
                  onClick={() => void scan()}
                  icon={<RefreshCw size={14} />}
                >
                  重新发现
                </Button>
              </Space>
            }
          >
            <Select
              aria-label="本机世界"
              loading={scanning}
              placeholder="选择要与好友连接的世界"
              value={worldPort}
              options={worlds.map((w) => ({
                value: w.port,
                label: (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {w.name}
                    </span>
                    <Space size={8}>
                      {w.version && (
                        <Tag style={{ marginInlineEnd: 0 }}>{w.version}</Tag>
                      )}
                      <span style={{ color: "var(--muted)", fontSize: 12 }}>
                        端口 {w.port}
                      </span>
                    </Space>
                  </span>
                ),
              }))}
              onChange={setWorldPort}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        open={retainedDialog.open && shownDialog === "join"}
        title="加入游戏联机"
        className="cinema-dialog"
        centered
        afterClose={retainedDialog.afterClose}
        destroyOnHidden
        onCancel={close}
        footer={null}
      >
        <Form
          layout="vertical"
          onFinish={() =>
            void actions.run(async () => {
              const lookup = unwrap(
                await actions.api.POST("/api/v1/games/lookup", {
                  body: { code: code.trim().toUpperCase() },
                }),
              );
              setFound(lookup);
            })
          }
        >
          <Form.Item label="联机码">
            <Input
              maxLength={8}
              value={code}
              placeholder="输入好友分享的 8 位联机码"
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setFound(undefined);
              }}
            />
          </Form.Item>
          <Button
            htmlType="submit"
            block
            loading={busy}
            disabled={code.trim().length !== 8}
          >
            查找联机
          </Button>
        </Form>
        {found && (
          <div style={{ marginTop: 24 }}>
            <h3>{found.name}</h3>
            <p>
              <Space wrap size={12}>
                <span>主机：{found.hostName}</span>
                <span>
                  {found.memberCount} / {found.maxMembers} 人
                </span>
                {found.gameVersion && <Tag>{found.gameVersion}</Tag>}
              </Space>
            </p>
            <Button
              type="primary"
              block
              disabled={busy || found.memberCount >= found.maxMembers}
              onClick={() => void actions.run(request)}
            >
              {found.memberCount >= found.maxMembers
                ? "联机人数已满"
                : "申请加入"}
            </Button>
          </div>
        )}
      </Modal>
      <Modal
        open={retainedDialog.open && shownDialog === "invite"}
        title="邀请好友游戏联机"
        className="cinema-dialog"
        centered
        afterClose={retainedDialog.afterClose}
        destroyOnHidden
        onCancel={close}
        footer={null}
      >
        <List
          dataSource={accepted}
          locale={{ emptyText: "还没有可以邀请的好友" }}
          renderItem={(f) => (
            <List.Item
              actions={[
                <Button
                  key="invite"
                  type="primary"
                  disabled={
                    busy ||
                    sent.has(f.userId) ||
                    snapshot.members.some((m) => m.userId === f.userId)
                  }
                  onClick={() => void actions.run(() => invite(f.userId))}
                >
                  {sent.has(f.userId)
                    ? "已邀请"
                    : snapshot.members.some((m) => m.userId === f.userId)
                      ? "已加入"
                      : "邀请"}
                </Button>,
              ]}
            >
              <List.Item.Meta
                avatar={<Avatar>{friendDisplayName(f).slice(0, 1)}</Avatar>}
                title={friendDisplayName(f)}
                description={f.online ? "在线" : "离线"}
              />
            </List.Item>
          )}
        />
      </Modal>
    </Surface>
  );
}
const emptyGameRequests: import("@cinegather/contracts").GameRequest[] = [];
export function GameLinkNotifications() {
  const { game, user } = useApp(),
    { notification } = App.useApp(),
    seen = useRef(new Set<string>());
  const invitations = game.snapshot.invitations,
    requests =
      game.snapshot.self?.role === "host"
        ? game.snapshot.requests
        : emptyGameRequests;
  useEffect(() => {
    seen.current.clear();
    return () => {
      for (const key of seen.current) notification.destroy(key);
      seen.current.clear();
    };
  }, [user?.id, notification]);
  useEffect(() => {
    const active = new Set([
      ...invitations.map((i) => "game-invitation:" + i.id),
      ...requests.map((r) => "game-request:" + r.id),
    ]);
    for (const key of seen.current)
      if (!active.has(key)) {
        notification.destroy(key);
        if (seen.current.size > 1024) seen.current.delete(key);
      }
    for (const i of invitations) {
      const key = "game-invitation:" + i.id;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      if (!clientNotificationEnabled("invitation")) continue;
      notification.info({
        key,
        title: `${i.hostName} 邀请你游戏联机`,
        description: i.sessionName,
        duration: 10,
        actions: (
          <Space>
            <Button onClick={() => void actions.run(() => dismiss(i.id))}>
              婉拒
            </Button>
            <Button
              type="primary"
              onClick={() =>
                window.desktop?.gameLink
                  ? void actions.run(() => accept(i.id))
                  : update({ modal: "download" })
              }
            >
              {window.desktop?.gameLink ? "加入联机" : "下载客户端"}
            </Button>
          </Space>
        ),
      });
    }
    for (const r of requests) {
      const key = "game-request:" + r.id;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      if (!clientNotificationEnabled("room-request")) continue;
      notification.info({
        key,
        title: `${r.displayName} 申请加入联机`,
        description: r.sessionName,
        duration: 10,
        actions: (
          <Space>
            <Button onClick={() => void actions.run(() => decide(r.id, false))}>
              拒绝
            </Button>
            <Button
              type="primary"
              onClick={() => void actions.run(() => decide(r.id, true))}
            >
              同意
            </Button>
          </Space>
        ),
      });
    }
  }, [invitations, requests, notification]);
  return null;
}
