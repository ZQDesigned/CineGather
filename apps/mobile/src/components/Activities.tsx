import {
  nextPointsFeedback,
  pointsReason,
  boardCursorColor,
  boardLiveDraft,
  boardStrokePath,
  appendBoardSamples,
} from "@cinegather/client-core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  View,
  Text,
  Pressable,
  PanResponder,
  Switch,
  Alert,
} from "react-native";
import Svg, {
  Path,
  Rect,
  Text as SvgText,
  TSpan,
  Image as SvgImage,
  G,
} from "react-native-svg";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { randomUUID } from "expo-crypto";
import { router } from "expo-router";
import type {
  PointsSummary,
  BoardElement,
  BoardElementInput,
  BoardOperation,
  BoardPresence,
  BoardPresenceInput,
} from "@cinegather/contracts";
import { activities } from "../activities";
import { runtime } from "../runtime";
import { useRuntime, useSession, useMedia } from "./use-runtime";
import { Button, Field, Dialog, styles, Label } from "./ui";
export function useActivities() {
  return useSyncExternalStore(activities.subscribe, activities.getSnapshot);
}
export function ActivityConnection() {
  const state = useRuntime(),
    session = useSession(),
    { snapshot } = useActivities();
  const roomId = state.room?.mode === "standard" ? state.room.id : undefined,
    userId = session.user?.id,
    connected = state.roomState === "connected";
  const pointsSeen = useRef<{ userId?: string; summary?: PointsSummary }>({});
  useEffect(() => {
    const value = snapshot?.points;
    if (!value) return;
    const previous =
      pointsSeen.current.userId === userId
        ? pointsSeen.current.summary
        : undefined;
    const award = nextPointsFeedback(previous, value);
    if (
      !previous ||
      (value.latest?.sequence ?? 0) >= (previous.latest?.sequence ?? 0)
    )
      pointsSeen.current = { userId, summary: value };
    if (award)
      runtime.feedback.show({
        text: award.amount
          ? `+${award.amount} 积分 ${pointsReason(award)}${award.outcome === "capped" ? "，今日额度已用完" : ""}`
          : "今日积分已达上限，仍可继续游戏",
        tone: award.amount ? "success" : "info",
      });
  }, [snapshot?.points, userId]);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const client = activities;
    if (roomId && userId && connected) client.connect(roomId);
    return () => {
      client.disconnect();
      seen.current.clear();
    };
  }, [roomId, userId, connected, activities]);
  useEffect(() => {
    for (const request of snapshot?.requests ?? []) {
      if (request.userId === userId && request.status !== "approved") continue;
      const key = request.id + request.status;
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      runtime.notice(
        request.userId === userId
          ? "活动申请已同意"
          : `${request.name} 申请切换活动`,
        "可在房间的活动面板中处理",
      );
    }
  }, [snapshot, userId]);
  return null;
}
function BoardImage({ element }: { element: BoardElementInput }) {
  const [data, setData] = useState<string>();
  useEffect(() => {
    let active = true;
    void runtime.api
      .call("board-image", (c) =>
        c.GET("/api/v1/whiteboards/images/{imageId}", {
          params: { path: { imageId: element.imageId! } },
        }),
      )
      .then((r) => {
        if (active) setData(r.data);
      })
      .catch((e) => runtime.fail(e));
    return () => {
      active = false;
    };
  }, [element.imageId]);
  return data ? (
    <SvgImage
      href={{ uri: data }}
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      preserveAspectRatio="xMidYMid meet"
    />
  ) : null;
}
function Shape({ element: e }: { element: BoardElementInput }) {
  if (e.kind === "image") return <BoardImage element={e} />;
  if (e.kind === "path")
    return (
      <Path
        transform={`translate(${e.x} ${e.y})`}
        d={boardStrokePath(e.points)}
        stroke={e.color}
        strokeWidth={e.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    );
  if (e.kind === "rect")
    return (
      <Rect
        x={e.x}
        y={e.y}
        width={e.width}
        height={e.height}
        stroke={e.color}
        strokeWidth={e.strokeWidth}
        fill="none"
      />
    );
  return (
    <G>
      {e.kind === "note" && (
        <Rect
          x={e.x}
          y={e.y}
          width={e.width}
          height={e.height}
          fill="#e5d9f7"
          rx={6}
        />
      )}
      <SvgText x={e.x + 12} y={e.y + 30} fontSize={24} fill={e.color}>
        {(e.text ?? "").split("\n").map((line, i) => (
          <TSpan key={i} x={e.x + 12} dy={i ? 31 : 0}>
            {line}
          </TSpan>
        ))}
      </SvgText>
    </G>
  );
}
export function MobileWhiteboard({
  elements,
  contextKey = "history",
  exportable = true,
  editable = false,
  canUndo = false,
  canRedo = false,
  canClear = false,
  presence = [],
  onPresence,
  onOperation,
}: {
  elements: BoardElement[];
  contextKey?: string;
  exportable?: boolean;
  editable?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  canClear?: boolean;
  presence?: BoardPresence[];
  onPresence?: (frame: Omit<BoardPresenceInput, "generation">) => void;
  onOperation?: (operation: BoardOperation) => Promise<unknown>;
}) {
  const [tool, setTool] = useState<
      "pointer" | "path" | "rect" | "note" | "text" | "move" | "erase"
    >("path"),
    [color, setColor] = useState("#8161ac"),
    [draft, setDraft] = useState<BoardElementInput>(),
    [width, setWidth] = useState(320);
  const [text, setText] = useState(""),
    [textOpen, setTextOpen] = useState(false),
    [textElement, setTextElement] = useState<BoardElementInput>();
  const svg = useRef<Svg>(null);
  const [exporting, setExporting] = useState(false);
  const context = useRef({
    elements,
    editable,
    tool,
    color,
    width,
    onOperation,
    onPresence,
  });
  context.current = {
    elements,
    editable,
    tool,
    color,
    width,
    onOperation,
    onPresence,
  };
  const touchStart = useRef<[number, number]>([0, 0]);
  const gesture = useRef<
    | {
        element: BoardElementInput;
        original?: BoardElement;
        start: [number, number];
      }
    | undefined
  >(undefined);
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        !!context.current.onPresence || context.current.editable,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const c = context.current,
          scale = 1600 / c.width,
          x = e.nativeEvent.locationX * scale,
          y = e.nativeEvent.locationY * scale;
        touchStart.current = [x, y];
        c.onPresence?.({ cursor: { x, y }, draft: null });
        if (!c.editable || c.tool === "pointer") return;
        const existing = [...c.elements]
          .reverse()
          .find((el) =>
            el.kind === "path"
              ? el.points?.some(
                  (p) => Math.hypot(p[0] + el.x - x, p[1] + el.y - y) < 35,
                )
              : x >= el.x &&
                x <= el.x + el.width &&
                y >= el.y &&
                y <= el.y + el.height,
          );
        if (c.tool === "erase") {
          if (existing)
            void c
              .onOperation?.({
                type: "remove",
                elementId: existing.id,
                expectedVersion: existing.version,
              })
              .catch((e) => runtime.fail(e));
          return;
        }
        if (c.tool === "move") {
          if (existing)
            gesture.current = {
              element: { ...existing },
              original: existing,
              start: [x, y],
            };
          return;
        }
        const el: BoardElementInput = {
          id: randomUUID(),
          kind: c.tool,
          x,
          y,
          width: 260,
          height: 160,
          color: c.color,
          strokeWidth: 5,
          ...(c.tool === "path"
            ? { x: 0, y: 0, points: [[x, y] as [number, number]] }
            : {}),
        };
        if (c.tool === "note" || c.tool === "text") {
          setText("");
          setTextElement(el);
          setTextOpen(true);
          return;
        }
        gesture.current = { element: el, start: [x, y] };
        setDraft({ ...el });
        c.onPresence?.({ cursor: { x, y }, draft: boardLiveDraft(el) });
      },
      onPanResponderMove: (_e, state) => {
        const g = gesture.current;
        const scale = 1600 / context.current.width,
          x = touchStart.current[0] + state.dx * scale,
          y = touchStart.current[1] + state.dy * scale;
        if (!g) {
          context.current.onPresence?.({ cursor: { x, y }, draft: null });
          return;
        }
        if (g.original) {
          g.element.x = g.original.x + state.dx * scale;
          g.element.y = g.original.y + state.dy * scale;
        } else if (g.element.kind === "path") {
          appendBoardSamples(g.element.points!, [[x, y]]);
        } else {
          g.element.x = Math.min(g.start[0], x);
          g.element.y = Math.min(g.start[1], y);
          g.element.width = Math.abs(x - g.start[0]);
          g.element.height = Math.abs(y - g.start[1]);
        }
        setDraft({ ...g.element });
        context.current.onPresence?.({
          cursor: { x, y },
          draft: boardLiveDraft(g.element, g.original?.version),
        });
      },
      onPanResponderRelease: () => {
        const g = gesture.current;
        gesture.current = undefined;
        if (g) {
          const {
            authorId: _a,
            version: _v,
            ...element
          } = g.element as BoardElement;
          void context.current
            .onOperation?.({
              type: "put",
              element,
              expectedVersion: g.original?.version,
            })
            .catch((e) => runtime.fail(e))
            .finally(() => {
              setDraft((current) =>
                current?.id === element.id ? undefined : current,
              );
              if (!gesture.current)
                context.current.onPresence?.({ cursor: null, draft: null });
            });
        } else context.current.onPresence?.({ cursor: null, draft: null });
      },
      onPanResponderTerminate: () => {
        context.current.onPresence?.({ cursor: null, draft: null });
        gesture.current = undefined;
        setDraft(undefined);
      },
    }),
  ).current;
  useEffect(() => {
    gesture.current = undefined;
    setDraft(undefined);
    setTextOpen(false);
    setTool(editable ? "path" : "pointer");
    context.current.onPresence?.({ cursor: null, draft: null });
    return () => context.current.onPresence?.({ cursor: null, draft: null });
  }, [editable, contextKey]);
  return (
    <View style={{ gap: 10 }}>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{
          aspectRatio: 16 / 9,
          backgroundColor: "#f1eef6",
          borderRadius: 12,
          overflow: "hidden",
        }}
        {...responder.panHandlers}
      >
        <Svg
          ref={svg}
          width="100%"
          height="100%"
          viewBox="0 0 1600 900"
          pointerEvents="none"
        >
          <Rect x={0} y={0} width={1600} height={900} fill="#f1eef6" />
          {elements
            .filter((e) => e.id !== draft?.id)
            .map((e) => (
              <Shape key={e.id} element={e} />
            ))}
          {draft && <Shape element={draft} />}
        </Svg>
        <Svg
          style={{ position: "absolute", inset: 0 }}
          width="100%"
          height="100%"
          viewBox="0 0 1600 900"
          pointerEvents="none"
        >
          {presence.map((peer) => (
            <G key={peer.userId}>
              {peer.draft && (
                <G opacity={0.85}>
                  <Shape element={peer.draft.element} />
                </G>
              )}
              {peer.cursor && (
                <G transform={`translate(${peer.cursor.x} ${peer.cursor.y})`}>
                  <Path
                    d="M0 0 L0 28 L8 21 L15 34 L21 31 L14 18 L25 18 Z"
                    fill={boardCursorColor(peer.userId)}
                    stroke="#fff"
                    strokeWidth={2}
                  />
                  <Rect
                    x={24}
                    y={22}
                    width={Math.min(peer.name.length, 20) * 20 + 20}
                    height={32}
                    rx={8}
                    fill={boardCursorColor(peer.userId)}
                  />
                  <SvgText x={34} y={44} fontSize={20} fill="#fff">
                    {peer.name.slice(0, 20)}
                  </SvgText>
                </G>
              )}
            </G>
          ))}
        </Svg>
      </View>
      {editable && (
        <>
          <View style={[styles.row, { flexWrap: "wrap", gap: 6 }]}>
            {(
              [
                ["pointer", "指针"],
                ["path", "画笔"],
                ["rect", "矩形"],
                ["text", "文字"],
                ["note", "便签"],
                ["move", "移动"],
                ["erase", "擦除"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                primary={tool === value}
                onPress={() => setTool(value)}
                style={{ minHeight: 36, paddingHorizontal: 10 }}
              >
                {label}
              </Button>
            ))}
          </View>
          <View style={[styles.row, { flexWrap: "wrap", gap: 8 }]}>
            {["#8161ac", "#20202a", "#d95757", "#27825c", "#2e6db6"].map(
              (value) => (
                <Pressable
                  key={value}
                  accessibilityLabel={`颜色 ${value}`}
                  accessibilityRole="button"
                  onPress={() => setColor(value)}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: value,
                    borderWidth: color === value ? 3 : 0,
                    borderColor: "#fff",
                  }}
                />
              ),
            )}
            <Button
              disabled={!canUndo}
              onPress={() => onOperation?.({ type: "undo" })}
            >
              撤销
            </Button>
            <Button
              disabled={!canRedo}
              onPress={() => onOperation?.({ type: "redo" })}
            >
              重做
            </Button>
            {canClear && (
              <Button
                onPress={() =>
                  Alert.alert("清空白板？", "此操作不能撤销", [
                    { text: "取消", style: "cancel" },
                    {
                      text: "清空",
                      style: "destructive",
                      onPress: () =>
                        void onOperation?.({ type: "clear" }).catch((e) =>
                          runtime.fail(e),
                        ),
                    },
                  ])
                }
              >
                清空
              </Button>
            )}
          </View>
        </>
      )}
      {exportable && (
        <Button
          disabled={exporting}
          onPress={async () => {
            if (!svg.current || !(await Sharing.isAvailableAsync()))
              throw Error("当前设备无法打开分享面板");
            setExporting(true);
            const file = new File(
              Paths.cache,
              `cinegather-whiteboard-${Date.now()}.png`,
            );
            try {
              const data = await new Promise<string>((resolve, reject) => {
                const timer = setTimeout(
                  () => reject(Error("导出超时，请重试")),
                  10000,
                );
                svg.current!.toDataURL(
                  (value) => {
                    clearTimeout(timer);
                    resolve(value);
                  },
                  { width: 1600, height: 900 },
                );
              });
              file.write(
                Uint8Array.from(atob(data), (char) => char.charCodeAt(0)),
              );
              await Sharing.shareAsync(file.uri, {
                mimeType: "image/png",
                UTI: "public.png",
                dialogTitle: "导出白板",
              });
            } finally {
              if (file.exists) file.delete();
              setExporting(false);
            }
          }}
        >
          导出白板
        </Button>
      )}
      <Dialog
        visible={textOpen}
        title="添加文字"
        close={() => setTextOpen(false)}
      >
        <Field
          label="内容"
          value={text}
          onChangeText={setText}
          multiline
          maxLength={1000}
        />
        <Button
          primary
          disabled={!text.trim()}
          onPress={async () => {
            if (textElement) {
              await onOperation?.({
                type: "put",
                element: { ...textElement, text: text.trim() },
              });
              setTextOpen(false);
            }
          }}
        >
          加入白板
        </Button>
      </Dialog>
    </View>
  );
}
export function ActivityPreview() {
  const { snapshot, error, presence } = useActivities();
  return (
    <View style={{ gap: 8 }}>
      {snapshot && ["board", "game"].includes(snapshot.kind) && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/room-activity")}
        >
          <View style={[styles.card, { gap: 8 }]}>
            <Text style={styles.heading}>
              {snapshot.kind === "board"
                ? "协作白板"
                : snapshot.game?.kind === "draw"
                  ? "你画我猜"
                  : "猜词抢答"}
            </Text>
            {snapshot.board && snapshot.game?.kind !== "quiz" ? (
              <MobileWhiteboard
                elements={snapshot.board.elements}
                exportable={false}
                presence={presence}
              />
            ) : (
              <Label>{snapshot.game?.clue ?? "进入活动面板参加游戏"}</Label>
            )}
          </View>
        </Pressable>
      )}
      {error && <Label muted>{error}</Label>}
      <Button onPress={() => router.push("/room-activity")}>
        白板与聚会游戏
      </Button>
    </View>
  );
}
export function MobileActivityPermissions() {
  const { snapshot, status } = useActivities(),
    userId = useSession().user?.id,
    media = useMedia();
  if (!snapshot || snapshot.ownerId !== userId) return null;
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.heading}>活动发起权限</Text>
      {media.members
        .filter((m) => m.id !== userId)
        .map((member) => {
          const policy = snapshot.permissions.find(
            (p) => p.userId === member.id,
          );
          return (
            <View key={member.id} style={{ gap: 8 }}>
              <Label>{member.name}</Label>
              <View style={styles.spread}>
                <Label>白板</Label>
                <Switch
                  disabled={status !== "connected"}
                  value={policy?.board !== false}
                  onValueChange={(board) =>
                    void activities
                      .command({
                        type: "permissions",
                        userId: member.id,
                        board,
                      })
                      .catch((e) => runtime.fail(e))
                  }
                />
                <Label>游戏</Label>
                <Switch
                  disabled={status !== "connected"}
                  value={policy?.game !== false}
                  onValueChange={(game) =>
                    void activities
                      .command({
                        type: "permissions",
                        userId: member.id,
                        game,
                      })
                      .catch((e) => runtime.fail(e))
                  }
                />
              </View>
            </View>
          );
        })}
    </View>
  );
}

export function MobileWhiteboardEditors() {
  const { snapshot, status } = useActivities(),
    userId = useSession().user?.id,
    media = useMedia();
  const [open, setOpen] = useState(false);
  const display = useRef<
    | {
        context: { roomId: string; generation: number };
        members: { id: string; name: string }[];
        editors: string[];
      }
    | undefined
  >(undefined);
  if (
    open &&
    snapshot?.kind === "board" &&
    snapshot.starterId === userId &&
    display.current?.context.roomId === snapshot.roomId &&
    display.current.context.generation === snapshot.generation
  )
    display.current = {
      context: { roomId: snapshot.roomId, generation: snapshot.generation },
      members: media.members.filter((m) => m.id !== userId),
      editors: snapshot.board?.editorIds ?? [],
    };
  useEffect(
    () => setOpen(false),
    [snapshot?.roomId, snapshot?.generation, snapshot?.starterId],
  );
  return (
    <>
      {snapshot?.kind === "board" && snapshot.starterId === userId && (
        <Button
          onPress={() => {
            display.current = {
              context: {
                roomId: snapshot.roomId,
                generation: snapshot.generation,
              },
              members: media.members.filter((m) => m.id !== userId),
              editors: snapshot.board?.editorIds ?? [],
            };
            setOpen(true);
          }}
        >
          邀请编辑
        </Button>
      )}
      <Dialog visible={open} title="协作成员" close={() => setOpen(false)}>
        {display.current?.members.map((member) => {
          const enabled = display.current!.editors.includes(member.id);
          return (
            <View key={member.id} style={styles.spread}>
              <Label>{member.name}</Label>
              <Button
                disabled={status !== "connected"}
                onPress={async () => {
                  const saved = display.current!;
                  await activities.command(
                    {
                      type: "board-editor",
                      generation: saved.context.generation,
                      userId: member.id,
                      enabled: !enabled,
                    },
                    saved.context,
                  );
                }}
              >
                {enabled ? "收回编辑权限" : "邀请编辑"}
              </Button>
            </View>
          );
        })}
        {!display.current?.members.length && <Label>还没有其他成员</Label>}
      </Dialog>
    </>
  );
}
