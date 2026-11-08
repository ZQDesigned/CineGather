import { useEffect, useRef, useState } from "react";
import { View, Text, Alert, Image } from "react-native";
import { router } from "expo-router";
import { File, Paths } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import type { ActivityTarget, PartyAction } from "@cinegather/contracts";
import { activities, startActivity } from "../activities";
import { runtime } from "../runtime";
import { useSession } from "../components/use-runtime";
import {
  useActivities,
  MobileWhiteboard,
  MobileWhiteboardEditors,
} from "../components/Activities";
import { PartyCategorySummary } from "../components/PartyCategories";
import { Screen } from "../components/Screen";
import { Button, Label, Field, Dialog, styles } from "../components/ui";
const names: Record<ActivityTarget, string> = {
  board: "协作白板",
  draw: "你画我猜",
  quiz: "猜词抢答",
  screen: "屏幕共享",
};
export default function RoomActivity() {
  const { snapshot, status, error, presence } = useActivities(),
    userId = useSession().user?.id;
  const [partyBusy, setPartyBusy] = useState(false);
  const [categoryReady, setCategoryReady] = useState(false);
  const [answer, setAnswer] = useState(""),
    [now, setNow] = useState(Date.now()),
    [image, setImage] = useState<string>(),
    [imageOpen, setImageOpen] = useState(false),
    [imageContext, setImageContext] = useState<{
      roomId: string;
      generation: number;
    }>();
  const clock = useRef({ server: Date.now(), local: Date.now() });
  useEffect(() => {
    if (snapshot?.game)
      clock.current = { server: snapshot.game.serverTime, local: Date.now() };
  }, [snapshot?.game]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setImageOpen(false);
  }, [snapshot?.roomId, snapshot?.generation]);
  if (!snapshot)
    return (
      <Screen title="房间活动">
        <Label>
          {error ??
            (status === "connecting" ? "正在连接活动…" : "请先加入普通房间")}
        </Label>
        {status === "failed" && (
          <Button
            onPress={() => {
              const id = runtime.snapshot().room?.id;
              if (id) activities.connect(id);
            }}
          >
            重新连接活动
          </Button>
        )}
      </Screen>
    );
  const controlled =
      snapshot.ownerId === userId || snapshot.starterId === userId,
    owner = snapshot.ownerId === userId,
    policy = snapshot.permissions.find((p) => p.userId === userId),
    game = snapshot.game,
    board = snapshot.board,
    me = game?.players.find((p) => p.id === userId);
  const rerollSeconds = Math.max(
    0,
    Math.ceil(
      ((game?.rerollAvailableAt ?? 0) -
        clock.current.server -
        (now - clock.current.local)) /
        1000,
    ),
  );
  const enabled = status === "connected",
    generation = snapshot.generation;
  async function start(target: ActivityTarget, requestId?: string) {
    if (!snapshot) return;
    activities.assertContext(snapshot);
    if (snapshot.kind !== "idle" && !controlled && !requestId) {
      await activities.command({ type: "request", target, generation });
      runtime.feedback.show({ text: "申请已发送" });
      return;
    }
    await startActivity(target, requestId, undefined, snapshot);
    if (target === "screen")
      router.push({
        pathname: "/share-screen",
        params: { roomId: snapshot.roomId },
      });
  }
  function choose(target: ActivityTarget) {
    if (snapshot!.kind === "idle" || !controlled)
      void start(target).catch((e) => runtime.fail(e));
    else
      Alert.alert(
        `切换到${names[target]}？`,
        "当前白板将保存在参与成员的记录中",
        [
          { text: "取消", style: "cancel" },
          {
            text: "切换",
            onPress: () => void start(target).catch((e) => runtime.fail(e)),
          },
        ],
      );
  }
  async function party(action: PartyAction) {
    if (partyBusy) return;
    setPartyBusy(true);
    try {
      await activities.command({ type: "party", generation, action }, snapshot);
      if (action.type === "guess") setAnswer("");
    } finally {
      setPartyBusy(false);
    }
  }
  async function chooseImage() {
    const chosen = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: false,
      quality: 1,
    });
    const asset = chosen.assets?.[0];
    if (chosen.canceled || !asset) return;
    try {
      if (
        asset.width * asset.height > 40_000_000 ||
        (asset.fileSize ?? 0) > 20_000_000
      )
        throw Error("请选择不超过 20 MB 的图片");
      let ratio = Math.min(1, 2400 / asset.width, 1600 / asset.height);
      for (let attempt = 0; attempt < 7; attempt++) {
        const context = ImageManipulator.manipulate(asset.uri);
        context.resize({
          width: Math.max(1, Math.round(asset.width * ratio)),
          height: Math.max(1, Math.round(asset.height * ratio)),
        });
        const rendered = await context.renderAsync().catch((error) => {
          context.release();
          throw error;
        });
        const result = await rendered
          .saveAsync({
            format: SaveFormat.PNG,
            base64: true,
          })
          .finally(() => {
            rendered.release();
            context.release();
          });
        const cached = new File(result.uri);
        if (cached.uri.startsWith(Paths.cache.uri) && cached.exists)
          cached.delete();
        if (result.base64 && result.base64.length < 2_600_000) {
          activities.assertContext(snapshot!);
          setImage("data:image/png;base64," + result.base64);
          setImageContext({ roomId: snapshot!.roomId, generation });
          setImageOpen(true);
          return;
        }
        ratio *= 0.78;
      }
      throw Error("图片内容过大，请缩小后重试");
    } finally {
      const cached = new File(asset.uri);
      if (cached.uri.startsWith(Paths.cache.uri) && cached.exists)
        cached.delete();
    }
  }
  return (
    <Screen
      title={
        snapshot.kind === "board"
          ? "协作白板"
          : game
            ? names[game.kind]
            : "房间活动"
      }
    >
      <View style={[styles.row, { flexWrap: "wrap", gap: 8 }]}>
        <Button
          disabled={!enabled || (!owner && policy?.board === false)}
          onPress={() => choose("board")}
        >
          白板
        </Button>
        <Button
          disabled={!enabled || (!owner && policy?.game === false)}
          onPress={() => choose("draw")}
        >
          你画我猜
        </Button>
        <Button
          disabled={!enabled || (!owner && policy?.game === false)}
          onPress={() => choose("quiz")}
        >
          猜词抢答
        </Button>
        <Button
          disabled={!enabled || !runtime.canShare()}
          onPress={() => choose("screen")}
        >
          共享屏幕
        </Button>
      </View>
      {snapshot.kind !== "idle" && controlled && (
        <Button
          danger
          disabled={!enabled}
          onPress={() =>
            Alert.alert("结束活动？", "当前白板将保存到参与成员的白板记录", [
              { text: "取消", style: "cancel" },
              {
                text: "结束",
                style: "destructive",
                onPress: () =>
                  void activities
                    .command({ type: "end", generation }, snapshot)
                    .catch((e) => runtime.fail(e)),
              },
            ])
          }
        >
          结束活动
        </Button>
      )}
      {snapshot.requests.map((request) => (
        <View key={request.id} style={[styles.card, { gap: 10 }]}>
          <Text style={styles.heading}>
            {request.userId === userId ? "你的申请" : request.name}：
            {names[request.target]}
          </Text>
          <Label>
            {request.status === "approved"
              ? "已同意，等待申请人确认"
              : "等待处理"}
          </Label>
          <View style={styles.row}>
            <Button
              onPress={() =>
                activities.command({ type: "cancel", requestId: request.id })
              }
            >
              {request.userId === userId ? "取消申请" : "拒绝"}
            </Button>
            {request.userId === userId && request.status === "approved" ? (
              <Button primary onPress={() => start(request.target, request.id)}>
                确认开始
              </Button>
            ) : request.userId !== userId && request.status === "pending" ? (
              <Button
                primary
                onPress={() =>
                  activities.command({
                    type: "decide",
                    requestId: request.id,
                    approve: true,
                  })
                }
              >
                同意
              </Button>
            ) : null}
          </View>
        </View>
      ))}
      {game && (
        <View style={{ gap: 12 }}>
          <Label>
            第 {game.round} / {game.totalRounds || "—"} 轮{" "}
            {game.phase === "paused"
              ? "已暂停"
              : game.deadline
                ? `${Math.max(0, Math.ceil((game.deadline - clock.current.server - (now - clock.current.local)) / 1000))} 秒`
                : game.phase === "finished"
                  ? "本场结束"
                  : "等待准备"}
          </Label>
          {["lobby", "finished"].includes(game.phase) && (
            <PartyCategorySummary
              snapshot={snapshot}
              controlled={controlled}
              onAvailability={setCategoryReady}
            />
          )}
          {game.phase === "lobby" || game.phase === "finished" ? (
            <View style={styles.row}>
              <Button
                disabled={!enabled}
                onPress={() => party({ type: "ready", ready: !me?.ready })}
              >
                {me?.ready ? "取消准备" : "参加游戏"}
              </Button>
              {controlled && (
                <Button
                  primary
                  disabled={
                    !enabled ||
                    !categoryReady ||
                    game.players.filter((p) => p.ready).length < 2
                  }
                  onPress={() => party({ type: "start" })}
                >
                  开始游戏
                </Button>
              )}
            </View>
          ) : (
            controlled && (
              <Button
                disabled={!enabled || game.phase === "results"}
                onPress={() =>
                  party({ type: game.phase === "paused" ? "resume" : "pause" })
                }
              >
                {game.phase === "paused" ? "继续" : "暂停"}
              </Button>
            )
          )}
          {!me?.ready && !["lobby", "finished"].includes(game.phase) && (
            <Button
              disabled={!enabled}
              onPress={() => party({ type: "ready", ready: true })}
            >
              参加下一轮
            </Button>
          )}
          {game.choices ? (
            <View style={[styles.row, { flexWrap: "wrap" }]}>
              {game.choices.map((word, index) => (
                <View key={word} style={{ maxWidth: "100%", gap: 4 }}>
                  <Button
                    disabled={!enabled || partyBusy}
                    onPress={() =>
                      party({
                        type: "choose",
                        index,
                        choicesRevision: game.choicesRevision,
                      })
                    }
                  >
                    {word}
                  </Button>
                  {game.choiceAuthors?.[index] && (
                    <Text numberOfLines={1} style={styles.muted}>
                      {game.choiceAuthors[index]?.displayName} 投稿
                    </Text>
                  )}
                </View>
              ))}
              {game.rerollsRemaining !== undefined && (
                <Button
                  disabled={
                    !enabled ||
                    partyBusy ||
                    game.rerollsRemaining <= 0 ||
                    !game.canReroll ||
                    rerollSeconds > 0 ||
                    (game.deadline ?? 0) <=
                      clock.current.server + (now - clock.current.local)
                  }
                  onPress={() =>
                    party({
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
            </View>
          ) : game.answer ? (
            <View style={{ gap: 4 }}>
              <Label>题目：{game.answer}</Label>
              {game.answerAuthor && (
                <Label muted>{game.answerAuthor.displayName} 投稿</Label>
              )}
            </View>
          ) : (
            <Label>
              {game.clue ??
                (game.phase === "choosing"
                  ? "画手正在选择题目"
                  : game.category
                    ? `${game.category}  ${game.wordLength} 个字`
                    : "")}
            </Label>
          )}
        </View>
      )}
      <View
        style={board && game?.kind !== "quiz" ? undefined : { display: "none" }}
      >
        <MobileWhiteboard
          contextKey={`${snapshot.roomId}:${generation}:${game?.phase ?? snapshot.kind}`}
          elements={board?.elements ?? []}
          editable={enabled && board?.canEdit}
          presence={presence}
          onPresence={(frame) => activities.sendPresence(frame, snapshot)}
          canUndo={board?.canUndo}
          canRedo={board?.canRedo}
          canClear={controlled || game?.drawerId === userId}
          onOperation={(operation) =>
            activities.command(
              { type: "board", generation, operation },
              snapshot,
            )
          }
        />
      </View>
      <MobileWhiteboardEditors />
      {snapshot.kind === "board" && (
        <Label muted>{board?.canEdit ? "可编辑" : "仅查看"}</Label>
      )}
      {snapshot.kind === "board" && snapshot.starterId === userId && (
        <Button disabled={!enabled} onPress={chooseImage}>
          加入图片 / 系统截图
        </Button>
      )}
      {game && (
        <>
          <View style={{ gap: 8 }}>
            {game.players.map((p) => (
              <View key={p.id} style={styles.spread}>
                <Label>
                  {p.name}
                  {p.id === game.drawerId ? "（画手）" : ""}
                </Label>
                <Label>
                  {game.solvedIds.includes(p.id)
                    ? "已答对"
                    : p.ready
                      ? "已准备"
                      : "旁观"}
                </Label>
              </View>
            ))}
          </View>
          {game.phase === "playing" &&
            game.drawerId !== userId &&
            me?.ready &&
            !game.solvedIds.includes(userId!) && (
              <>
                <Field
                  label="答案"
                  value={answer}
                  onChangeText={setAnswer}
                  maxLength={80}
                  onSubmitEditing={() => {
                    if (answer.trim())
                      void party({
                        type: "guess",
                        answer: answer.trim(),
                      }).catch((e) => runtime.fail(e));
                  }}
                />
                <Button
                  primary
                  disabled={!enabled || !answer.trim()}
                  onPress={() =>
                    party({ type: "guess", answer: answer.trim() })
                  }
                >
                  提交答案
                </Button>
              </>
            )}
        </>
      )}
      <Button onPress={() => router.push("/whiteboards")}>白板记录</Button>
      <Dialog
        title="确认加入图片"
        visible={imageOpen}
        close={() => setImageOpen(false)}
      >
        {image && (
          <Image
            source={{ uri: image }}
            style={{ width: "100%", height: 240 }}
            resizeMode="contain"
          />
        )}
        <Button
          primary
          onPress={async () => {
            if (!image || !imageContext) return;
            activities.assertContext(imageContext);
            const uploaded = await runtime.api.call("board-upload", (c) =>
              c.POST("/api/v1/rooms/{roomId}/activity/images", {
                params: { path: { roomId: imageContext.roomId } },
                body: { generation: imageContext.generation, data: image },
              }),
            );
            activities.assertContext(imageContext);
            await activities.command({
              type: "board",
              generation: imageContext.generation,
              operation: {
                type: "put",
                element: {
                  id: randomUUID(),
                  kind: "image",
                  imageId: uploaded.id,
                  x: 80,
                  y: 60,
                  width: 1440,
                  height: 780,
                  color: "#8161ac",
                  strokeWidth: 3,
                },
              },
            });
            setImageOpen(false);
          }}
        >
          加入白板
        </Button>
      </Dialog>
    </Screen>
  );
}
