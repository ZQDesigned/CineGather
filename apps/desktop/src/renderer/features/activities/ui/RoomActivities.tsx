import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { App, Dropdown, Input, Modal, Switch, Tag, type MenuProps } from "antd";
import {
  PencilRuler,
  Gamepad2,
  MonitorUp,
  History,
  Square,
  X,
  Ellipsis,
} from "lucide-react";
import type {
  ActivityTarget,
  ActivityCommand,
  PartyAction,
  WhiteboardDocument,
  WhiteboardRecord,
  ActivitySnapshot,
} from "@cinegather/contracts";
import { unwrap } from "@cinegather/api-client";
import { roomActivities, startRoomActivity } from "../room-activities";
import { api, report } from "../../../controller";
import { useApp } from "../../../store";
import {
  publishClientNotification,
  resolveClientNotification,
} from "../../notifications/client-notifications";
import { Button } from "../../rooms/ui/Controls";
import { PartyCategoryPicker } from "./PartyCategoryPicker";
import { Whiteboard } from "./Whiteboard";
import { useRetainedDialog } from "../../../ui/useRetainedDialog";
const names: Record<ActivityTarget, string> = {
  board: "协作白板",
  draw: "你画我猜",
  quiz: "猜词抢答",
  screen: "屏幕共享",
};
export function useRoomActivity() {
  return useSyncExternalStore(
    roomActivities.subscribe,
    roomActivities.getSnapshot,
  );
}
function execute(
  command: ActivityCommand,
  expected?: Pick<ActivitySnapshot, "roomId" | "generation">,
) {
  return roomActivities.command(command, expected).catch(report);
}
export function useRoomActivityConnection() {
  const roomId = useApp((s) =>
      s.room?.mode === "standard" ? s.room.id : undefined,
    ),
    userId = useApp((s) => s.user?.id),
    connected = useApp((s) => s.roomState === "connected");
  useEffect(() => {
    if (roomId && userId && connected) roomActivities.connect(roomId);
    return () => roomActivities.disconnect();
  }, [roomId, userId, connected, roomActivities]);
  return useRoomActivity();
}
export function ActivityNotifications() {
  const { snapshot } = useRoomActivity(),
    userId = useApp((s) => s.user?.id),
    { notification } = App.useApp();
  const notices = useRef(new Map<string, string>());
  useEffect(
    () => () => {
      for (const key of notices.current.keys()) {
        notification.destroy(key);
        resolveClientNotification(key);
      }
      notices.current.clear();
    },
    [notification],
  );
  useEffect(() => {
    const requests = snapshot?.requests ?? [],
      keys = new Set(requests.map((r) => `activity-request:${r.id}`));
    for (const key of notices.current.keys())
      if (!keys.has(key)) {
        notification.destroy(key);
        resolveClientNotification(key);
        notices.current.delete(key);
      }
    for (const request of requests) {
      const own = request.userId === userId,
        key = `activity-request:${request.id}`,
        signature = JSON.stringify([request, own]);
      if (notices.current.get(key) === signature) continue;
      notices.current.set(key, signature);
      const approved = request.status === "approved";
      const title = own
        ? approved
          ? "活动申请已同意"
          : "活动申请已发送"
        : `${request.name} 申请${names[request.target]}`;
      if (!own || approved)
        publishClientNotification({
          eventId: `${key}:${request.status}`,
          groupId: key,
          category: "share-request",
          title,
          body: approved ? "确认后即可开始新活动。" : "返回房间处理申请。",
          target: "share",
          roomId: snapshot!.roomId,
          entityId: request.id,
        });
      notification.info({
        key,
        title,
        duration: 0,
        closable: false,
        description: approved
          ? "新活动确认开始后才会切换。"
          : "等待发起人或房主处理。",
        actions: (
          <div className="activity-actions">
            <Button
              onClick={() =>
                void execute({ type: "cancel", requestId: request.id })
              }
            >
              {own ? "取消申请" : approved ? "撤销同意" : "拒绝"}
            </Button>
            {own && approved ? (
              <Button
                type="primary"
                onClick={() =>
                  void startRoomActivity(
                    request.target,
                    request.id,
                    undefined,
                    snapshot!,
                  ).catch(report)
                }
              >
                确认开始
              </Button>
            ) : !own && !approved ? (
              <Button
                type="primary"
                onClick={() =>
                  void execute({
                    type: "decide",
                    requestId: request.id,
                    approve: true,
                  })
                }
              >
                同意
              </Button>
            ) : null}
          </div>
        ),
      });
    }
  }, [snapshot, userId, notification]);
  return null;
}
export function RoomActivityControls({
  compact = false,
  visible = true,
  toolbarTarget,
}: {
  compact?: boolean;
  visible?: boolean;
  toolbarTarget?: HTMLElement | null;
}) {
  const { snapshot, status, error } = useRoomActivity(),
    userId = useApp((s) => s.user?.id),
    [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{
      kind: "game" | "switch" | "end";
      target?: ActivityTarget;
      context: Pick<ActivitySnapshot, "roomId" | "generation">;
    }>(),
    retained = useRetainedDialog(dialog);
  const [history, setHistory] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    if (!compact || !visible) setMenuOpen(false);
  }, [compact, visible]);
  const pendingScreen = useRef<
    Pick<ActivitySnapshot, "roomId" | "generation"> | undefined
  >(undefined);
  const controlled =
    snapshot?.ownerId === userId || snapshot?.starterId === userId;
  const policy = snapshot?.permissions.find((p) => p.userId === userId),
    owner = snapshot?.ownerId === userId;
  const disabled = !snapshot || status !== "connected" || busy;
  async function start(
    target: ActivityTarget,
    expected:
      | Pick<ActivitySnapshot, "roomId" | "generation">
      | undefined = snapshot,
  ) {
    if (!snapshot) {
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      if (expected) roomActivities.assertContext(expected);
      if (snapshot.kind !== "idle" && !controlled)
        await roomActivities.command({
          type: "request",
          target,
          generation: snapshot.generation,
        });
      else await startRoomActivity(target, undefined, undefined, expected);
      setDialog(undefined);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  function select(target: ActivityTarget) {
    if (!snapshot) return;
    if (snapshot.kind !== "idle" && controlled)
      setDialog({ kind: "switch", target, context: snapshot });
    else void start(target);
  }
  const items: MenuProps["items"] = [
    {
      key: "board",
      label: "白板",
      icon: <PencilRuler size={16} />,
      disabled: disabled || (!owner && policy?.board === false),
    },
    {
      key: "game",
      label: "聚会游戏",
      icon: <Gamepad2 size={16} />,
      disabled: disabled || (!owner && policy?.game === false),
    },
    {
      key: "screen",
      label: controlled ? "切换到共享" : "申请共享",
      icon: <MonitorUp size={16} />,
      disabled,
    },
    { type: "divider" },
    { key: "history", label: "白板记录", icon: <History size={16} /> },
    ...(controlled
      ? [
          { type: "divider" as const },
          {
            key: "end",
            label: "结束活动",
            icon: <Square size={15} />,
            danger: true,
            disabled,
          },
        ]
      : []),
  ];
  const controls = (
    <div className="room-activity-controls">
      {compact ? (
        <Dropdown
          open={visible && menuOpen}
          onOpenChange={setMenuOpen}
          trigger={["click"]}
          placement="bottomRight"
          menu={{
            items,
            onClick: ({ key }) => {
              setMenuOpen(false);
              if (key === "history") setHistory(true);
              else if (key === "game" && snapshot)
                setDialog({ kind: "game", context: snapshot });
              else if (key === "end" && snapshot)
                setDialog({ kind: "end", context: snapshot });
              else if (key === "board" || key === "screen") select(key);
            },
          }}
        >
          <Button aria-label="活动菜单">
            <Ellipsis size={17} />
            活动
          </Button>
        </Dropdown>
      ) : (
        <>
          <Button
            disabled={disabled || (!owner && policy?.board === false)}
            onClick={() => select("board")}
          >
            <PencilRuler size={17} />
            白板
          </Button>
          <Button
            disabled={disabled || (!owner && policy?.game === false)}
            onClick={() =>
              snapshot && setDialog({ kind: "game", context: snapshot })
            }
          >
            <Gamepad2 size={17} />
            聚会游戏
          </Button>
          {(snapshot?.kind === "board" || snapshot?.kind === "game") && (
            <Button disabled={disabled} onClick={() => select("screen")}>
              <MonitorUp size={17} />
              {controlled ? "切换到共享" : "申请共享"}
            </Button>
          )}
          {snapshot &&
            ["board", "game"].includes(snapshot.kind) &&
            controlled && (
              <Button
                disabled={disabled}
                onClick={() => setDialog({ kind: "end", context: snapshot })}
              >
                <Square size={15} />
                结束活动
              </Button>
            )}
          <span className="activity-spacer" />
          <Button onClick={() => setHistory(true)}>
            <History size={16} />
            白板记录
          </Button>
        </>
      )}
      {status === "reconnecting" &&
        (snapshot?.kind === "board" || snapshot?.kind === "game") && (
          <small>正在恢复活动连接…</small>
        )}
      {status === "failed" && (
        <>
          <small>{error ?? "活动暂不可用"}</small>
          <Button
            onClick={() => {
              const id = useApp.getState().room?.id;
              if (id) roomActivities.connect(id);
            }}
          >
            重新连接活动
          </Button>
        </>
      )}
    </div>
  );
  return (
    <>
      {toolbarTarget ? createPortal(controls, toolbarTarget) : controls}
      <Modal
        open={retained.open}
        afterClose={() => {
          retained.afterClose();
          const expected = pendingScreen.current;
          if (expected && !dialog) {
            pendingScreen.current = undefined;
            void start("screen", expected);
          }
        }}
        title={
          retained.value?.kind === "game"
            ? "聚会游戏"
            : retained.value?.kind === "end"
              ? "结束当前活动？"
              : `切换到${names[retained.value?.target ?? "board"]}？`
        }
        onCancel={() => setDialog(undefined)}
        footer={retained.value?.kind === "game" ? null : undefined}
        onOk={() => {
          if (retained.value?.kind === "end" && snapshot)
            void roomActivities
              .command(
                { type: "end", generation: retained.value.context.generation },
                retained.value.context,
              )
              .then(() => setDialog(undefined))
              .catch(report);
          else if (retained.value?.target === "screen") {
            pendingScreen.current = retained.value.context;
            setBusy(true);
            setDialog(undefined);
          } else if (retained.value?.target)
            void start(retained.value.target, retained.value.context);
        }}
        confirmLoading={busy}
        okText="确认"
        cancelText="取消"
        centered
        destroyOnHidden
      >
        {retained.value?.kind === "game" ? (
          <div className="party-picker">
            <Button
              disabled={busy}
              onClick={() => {
                if (snapshot?.kind !== "idle" && controlled)
                  setDialog({
                    kind: "switch",
                    target: "draw",
                    context: retained.value!.context,
                  });
                else void start("draw", retained.value!.context);
              }}
            >
              你画我猜
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                if (snapshot?.kind !== "idle" && controlled)
                  setDialog({
                    kind: "switch",
                    target: "quiz",
                    context: retained.value!.context,
                  });
                else void start("quiz", retained.value!.context);
              }}
            >
              猜词抢答
            </Button>
          </div>
        ) : (
          <p>当前白板会保存到参与成员的白板记录。</p>
        )}
      </Modal>
      <WhiteboardHistory open={history} onClose={() => setHistory(false)} />
    </>
  );
}
export function RoomActivityStage() {
  const { snapshot: current, presence = [] } = useRoomActivity(),
    userId = useApp((s) => s.user?.id),
    [answer, setAnswer] = useState(""),
    [busy, setBusy] = useState(false),
    [categoryReady, setCategoryReady] = useState(false),
    [now, setNow] = useState(Date.now());
  const clock = useRef({ server: Date.now(), local: Date.now() });
  const retained = useRef<ActivitySnapshot | undefined>(undefined);
  const active = current && ["board", "game"].includes(current.kind);
  if (active) retained.current = current;
  const snapshot = retained.current;
  useEffect(() => {
    if (snapshot?.game)
      clock.current = { server: snapshot.game.serverTime, local: Date.now() };
  }, [snapshot?.game]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
  if (!snapshot || !["board", "game"].includes(snapshot.kind)) return null;
  const board = snapshot.board!,
    game = snapshot.game,
    controlled = snapshot.ownerId === userId || snapshot.starterId === userId;
  const editable = board.canEdit;
  const party = async (action: PartyAction) => {
    setBusy(true);
    try {
      await roomActivities.command({
        type: "party",
        generation: snapshot.generation,
        action,
      });
      if (action.type === "guess") setAnswer("");
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  };
  const seconds = game?.deadline
    ? Math.max(
        0,
        Math.ceil(
          (game.deadline - clock.current.server - (now - clock.current.local)) /
            1000,
        ),
      )
    : 0;
  const rerollSeconds = Math.max(
    0,
    Math.ceil(
      ((game?.rerollAvailableAt ?? 0) -
        clock.current.server -
        (now - clock.current.local)) /
        1000,
    ),
  );
  const me = game?.players.find((p) => p.id === userId);
  return (
    <section
      className="room-activity-stage"
      data-active={active}
      style={active ? undefined : { display: "none" }}
    >
      <header>
        <strong>
          {snapshot.kind === "board" ? "协作白板" : names[game!.kind]}
        </strong>
        {snapshot.kind === "board" && (
          <>
            <span>{editable ? "可编辑" : "仅查看"}</span>
            <WhiteboardEditors />
          </>
        )}
        {game && (
          <>
            <span>
              第 {game.round} / {game.totalRounds || "—"} 轮
            </span>
            <Tag>
              {game.phase === "paused"
                ? "已暂停"
                : game.phase === "lobby"
                  ? "等待准备"
                  : game.phase === "finished"
                    ? "本场结束"
                    : `${seconds} 秒`}
            </Tag>
          </>
        )}
        {game && (
          <PartyCategoryPicker
            snapshot={snapshot}
            controlled={controlled}
            onAvailability={setCategoryReady}
          />
        )}
        {game && (
          <div className="party-status">
            {game.phase === "lobby" || game.phase === "finished" ? (
              <>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void party({ type: "ready", ready: !me?.ready })
                  }
                >
                  {me?.ready ? "取消准备" : "参加游戏"}
                </Button>
                {controlled && (
                  <Button
                    type="primary"
                    disabled={
                      busy ||
                      !categoryReady ||
                      game.players.filter((p) => p.ready).length < 2
                    }
                    onClick={() => void party({ type: "start" })}
                  >
                    开始游戏
                  </Button>
                )}
              </>
            ) : (
              <>
                {controlled && (
                  <Button
                    disabled={busy || game.phase === "results"}
                    onClick={() =>
                      void party({
                        type: game.phase === "paused" ? "resume" : "pause",
                      })
                    }
                  >
                    {game.phase === "paused" ? "继续" : "暂停"}
                  </Button>
                )}
                {!me?.ready && (
                  <Button
                    onClick={() => void party({ type: "ready", ready: true })}
                  >
                    参加下一轮
                  </Button>
                )}
              </>
            )}
            {game.choices ? (
              <div className="party-choices">
                {game.choices.map((word, index) => (
                  <Button
                    key={word}
                    disabled={busy}
                    onClick={() =>
                      void party({
                        type: "choose",
                        index,
                        choicesRevision: game.choicesRevision,
                      })
                    }
                  >
                    {word}
                    {game.choiceAuthors?.[index] && (
                      <small
                        style={{ marginLeft: 8, opacity: 0.7, fontWeight: 400 }}
                      >
                        {game.choiceAuthors[index]?.displayName} 投稿
                      </small>
                    )}
                  </Button>
                ))}
                {game.rerollsRemaining !== undefined && (
                  <Button
                    disabled={
                      busy ||
                      game.rerollsRemaining <= 0 ||
                      !game.canReroll ||
                      rerollSeconds > 0 ||
                      seconds <= 0
                    }
                    onClick={() =>
                      void party({
                        type: "reroll",
                        choicesRevision: game.choicesRevision,
                      })
                    }
                  >
                    {game.rerollsRemaining <= 0
                      ? "换词次数已用完"
                      : !game.canReroll
                        ? "暂无更多题目"
                        : rerollSeconds > 0
                          ? `换一组（${rerollSeconds}秒）`
                          : `换一组（剩余 ${game.rerollsRemaining} 次）`}
                  </Button>
                )}
              </div>
            ) : game.answer ? (
              <strong>
                {game.drawerId === userId && game.phase === "playing"
                  ? "你的题目："
                  : "答案："}
                {game.answer}
                {game.answerAuthor && (
                  <small
                    style={{ marginLeft: 10, opacity: 0.7, fontWeight: 400 }}
                  >
                    {game.answerAuthor.displayName} 投稿
                  </small>
                )}
              </strong>
            ) : game.phase === "choosing" ? (
              <span>等待画手选择题目</span>
            ) : game.phase === "playing" ? (
              <span>
                {game.category} {game.wordLength} 个字
              </span>
            ) : null}
          </div>
        )}
      </header>
      <div
        className="activity-board-content"
        style={!game || game.kind === "draw" ? undefined : { display: "none" }}
      >
        <Whiteboard
          workspace
          contextKey={`${current?.roomId}:${current?.generation}:${Boolean(active)}:${game?.phase ?? "board"}`}
          elements={board.elements}
          presence={presence}
          onPresence={(frame) => {
            if (active && current) roomActivities.sendPresence(frame, current);
          }}
          editable={Boolean(active && editable)}
          exportable={snapshot.kind === "board"}
          importable={
            snapshot.kind === "board" && snapshot.starterId === userId
          }
          canUndo={board.canUndo}
          canRedo={board.canRedo}
          canClear={controlled || game?.drawerId === userId}
          onOperation={(operation) =>
            roomActivities
              .command(
                {
                  type: "board",
                  generation: snapshot.generation,
                  operation,
                },
                snapshot,
              )
              .then(() => {})
          }
          onImage={async (data) => {
            const image = unwrap(
              await api.POST("/api/v1/rooms/{roomId}/activity/images", {
                params: { path: { roomId: snapshot.roomId } },
                body: { generation: snapshot.generation, data },
              }),
            );
            roomActivities.assertContext(snapshot);
            await roomActivities.command({
              type: "board",
              generation: snapshot.generation,
              operation: {
                type: "put",
                element: {
                  id: crypto.randomUUID(),
                  kind: "image",
                  imageId: image.id,
                  x: 80,
                  y: 60,
                  width: 1440,
                  height: 780,
                  color: "#8161ac",
                  strokeWidth: 3,
                },
              },
            });
          }}
        />
      </div>
      {game?.kind === "quiz" && (
        <div className="quiz-clue">
          <Gamepad2 size={36} />
          <h2>
            {game.clue ??
              (game.phase === "lobby" ? "准备好，一起抢答" : "等待下一轮")}
          </h2>
        </div>
      )}
      {game && (
        <>
          {game.phase === "playing" &&
            game.drawerId !== userId &&
            me?.ready &&
            !game.solvedIds.includes(userId!) && (
              <form
                className="party-answer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (answer.trim())
                    void party({ type: "guess", answer: answer.trim() });
                }}
              >
                <Input
                  aria-label="提交答案"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  maxLength={80}
                  placeholder="输入你的答案"
                />
                <Button
                  htmlType="submit"
                  type="primary"
                  disabled={busy || !answer.trim()}
                >
                  提交
                </Button>
              </form>
            )}
        </>
      )}
    </section>
  );
}
export function ActivityPermissionSettings() {
  const { snapshot, status } = useRoomActivity(),
    app = useApp();
  if (!snapshot || snapshot.ownerId !== app.user?.id) return null;
  return (
    <section className="activity-permissions">
      <h3>活动发起权限</h3>
      {app.media.participants
        .filter((p) => p.id !== snapshot.ownerId)
        .map((member) => {
          const policy = snapshot.permissions.find(
            (p) => p.userId === member.id,
          );
          return (
            <div key={member.id}>
              <span>{member.name}</span>
              <label>
                白板{" "}
                <Switch
                  size="small"
                  checked={policy?.board !== false}
                  disabled={status !== "connected"}
                  onChange={(board) =>
                    void execute({
                      type: "permissions",
                      userId: member.id,
                      board,
                    })
                  }
                />
              </label>
              <label>
                游戏{" "}
                <Switch
                  size="small"
                  checked={policy?.game !== false}
                  disabled={status !== "connected"}
                  onChange={(game) =>
                    void execute({
                      type: "permissions",
                      userId: member.id,
                      game,
                    })
                  }
                />
              </label>
            </div>
          );
        })}
    </section>
  );
}
export function WhiteboardHistory({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const retained = useRetainedDialog(open ? true : undefined),
    [items, setItems] = useState<WhiteboardRecord[]>([]),
    [record, setRecord] = useState<{ id: string; board: WhiteboardDocument }>(),
    [busy, setBusy] = useState(false);
  const [copying, setCopying] = useState<{
      id: string;
      context: Pick<ActivitySnapshot, "roomId" | "generation">;
    }>(),
    copy = useRetainedDialog(copying);
  const [deleting, setDeleting] = useState<WhiteboardRecord>(),
    removal = useRetainedDialog(deleting),
    { snapshot, status } = useRoomActivity();
  const { message } = App.useApp();
  async function refresh() {
    const result = unwrap(await api.GET("/api/v1/whiteboards"));
    setItems((result as { items: WhiteboardRecord[] }).items);
  }
  useEffect(() => {
    if (!open) return;
    let active = true;
    void api
      .GET("/api/v1/whiteboards")
      .then(unwrap)
      .then((r) => {
        if (active) setItems((r as { items: WhiteboardRecord[] }).items);
      })
      .catch(report);
    return () => {
      active = false;
    };
  }, [open]);
  const selectedRef = useRef<string | undefined>(undefined);
  async function select(id: string) {
    selectedRef.current = id;
    try {
      const board = unwrap(
        await api.GET("/api/v1/whiteboards/{whiteboardId}", {
          params: { path: { whiteboardId: id } },
        }),
      ) as WhiteboardDocument;
      if (selectedRef.current === id) setRecord({ id, board });
    } catch (e) {
      report(e);
    }
  }
  return (
    <>
      <Modal
        title="白板记录"
        open={retained.open}
        afterClose={() => {
          retained.afterClose();
          if (!open) {
            setRecord(undefined);
            selectedRef.current = undefined;
          }
        }}
        onCancel={onClose}
        footer={null}
        width={1050}
        centered
        destroyOnHidden
      >
        <div className="whiteboard-history">
          {record ? (
            <>
              <Button
                onClick={() => {
                  selectedRef.current = undefined;
                  setRecord(undefined);
                }}
              >
                返回记录
              </Button>
              <Whiteboard
                elements={record.board.elements}
                editable={false}
                importable={false}
                canUndo={false}
                canRedo={false}
                canClear={false}
                onOperation={async () => {}}
              />
              {snapshot && status === "connected" && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    if (
                      snapshot.kind !== "idle" &&
                      ![snapshot.ownerId, snapshot.starterId].includes(
                        useApp.getState().user?.id,
                      )
                    ) {
                      report(Error("请先申请切换到白板，再载入记录"));
                      return;
                    }
                    setCopying({ id: record.id, context: snapshot });
                  }}
                >
                  以此创建新白板
                </Button>
              )}
            </>
          ) : items.length ? (
            items.map((item) => (
              <div className="whiteboard-record" key={item.id}>
                <Button type="text" onClick={() => void select(item.id)}>
                  <History size={16} />
                  <span>
                    {item.title}
                    <small>{new Date(item.createdAt).toLocaleString()}</small>
                  </span>
                </Button>
                <Button
                  aria-label="删除白板记录"
                  onClick={() => setDeleting(item)}
                >
                  <X size={16} />
                </Button>
              </div>
            ))
          ) : (
            <p>还没有白板记录</p>
          )}
        </div>
      </Modal>
      <Modal
        title="以此创建新白板？"
        open={copy.open}
        afterClose={copy.afterClose}
        onCancel={() => setCopying(undefined)}
        confirmLoading={busy}
        okText="创建"
        cancelText="取消"
        onOk={() => {
          const target = copy.value;
          if (!target) return;
          setBusy(true);
          void startRoomActivity("board", undefined, target.id, target.context)
            .then(() => {
              setCopying((current) =>
                current === target ? undefined : current,
              );
              onClose();
            })
            .catch(report)
            .finally(() => setBusy(false));
        }}
      >
        <p>当前活动将结束，记录中的原件不会改变。</p>
      </Modal>
      <Modal
        title="删除这份记录？"
        open={removal.open}
        afterClose={removal.afterClose}
        onCancel={() => setDeleting(undefined)}
        onOk={() => {
          if (!removal.value) return;
          setBusy(true);
          void api
            .DELETE("/api/v1/whiteboards/{whiteboardId}", {
              params: { path: { whiteboardId: removal.value.id } },
            })
            .then(unwrap)
            .then(async () => {
              await refresh();
              setDeleting(undefined);
              void message.success("记录已删除");
            })
            .catch(report)
            .finally(() => setBusy(false));
        }}
        confirmLoading={busy}
        okText="删除"
        cancelText="取消"
      >
        <p>仅删除你的记录，不影响其他成员的白板。</p>
      </Modal>
    </>
  );
}

function WhiteboardEditors() {
  const { snapshot, status } = useRoomActivity(),
    userId = useApp((s) => s.user?.id),
    members = useApp((s) => s.media.participants);
  const [target, setTarget] = useState<{
    roomId: string;
    generation: number;
  }>();
  const retained = useRetainedDialog(target),
    display = useRef<{
      members: { id: string; name: string }[];
      editors: string[];
    }>({ members: [], editors: [] });
  if (
    retained.open &&
    snapshot &&
    snapshot.roomId === target?.roomId &&
    snapshot?.generation === target?.generation
  )
    display.current = {
      members: members
        .filter((m) => m.id !== snapshot.starterId)
        .map((m) => ({ id: m.id, name: m.name })),
      editors: snapshot.board?.editorIds ?? [],
    };
  useEffect(() => {
    setTarget(undefined);
  }, [snapshot?.roomId, snapshot?.generation, snapshot?.starterId]);
  return (
    <>
      {snapshot?.kind === "board" && snapshot.starterId === userId && (
        <Button
          onClick={() =>
            setTarget({
              roomId: snapshot.roomId,
              generation: snapshot.generation,
            })
          }
        >
          邀请编辑
        </Button>
      )}
      <Modal
        title="协作成员"
        open={retained.open}
        afterClose={retained.afterClose}
        onCancel={() => setTarget(undefined)}
        footer={null}
        centered
        destroyOnHidden
      >
        {display.current.members.length ? (
          display.current.members.map((member) => {
            const enabled = display.current.editors.includes(member.id);
            return (
              <div key={member.id} className="whiteboard-editor">
                <span>{member.name}</span>
                <Button
                  disabled={status !== "connected"}
                  onClick={() => {
                    const context = retained.value;
                    if (context)
                      void execute(
                        {
                          type: "board-editor",
                          generation: context.generation,
                          userId: member.id,
                          enabled: !enabled,
                        },
                        context,
                      );
                  }}
                >
                  {enabled ? "收回编辑权限" : "邀请编辑"}
                </Button>
              </div>
            );
          })
        ) : (
          <p>还没有其他成员</p>
        )}
      </Modal>
    </>
  );
}
