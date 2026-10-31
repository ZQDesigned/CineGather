import { MaintenanceBanner } from "../components/MaintenanceBanner";
import {
  useEffect,
  useState,
  useLayoutEffect,
  useRef,
  useCallback,
} from "react";
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  AppState,
  Share,
} from "react-native";
import { router, useFocusEffect, useNavigation } from "expo-router";
import { VideoTrack } from "@livekit/react-native";
import Slider from "@react-native-community/slider";
import * as Orientation from "expo-screen-orientation";
import { runtime } from "../runtime";
import {
  useRuntime,
  useMedia,
  useSession,
  action,
} from "../components/use-runtime";
import {
  Page,
  styles,
  colors,
  Button,
  Field,
  Dialog,
  Avatar,
  Label,
} from "../components/ui";
export default function RoomScreen() {
  const state = useRuntime(),
    media = useMedia(),
    session = useSession();
  const [tab, setTab] = useState<"members" | "chat">("members"),
    [draft, setDraft] = useState("");
  const [selected, setSelected] = useState<string>(),
    [outputs, setOutputs] = useState<string[]>([]),
    [audio, setAudio] = useState(false);
  const [voice, setVoice] = useState(1),
    [shared, setShared] = useState(1),
    [memberGain, setMemberGain] = useState(1);
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(""),
    [max, setMax] = useState("5");
  const [fullscreen, setFullscreen] = useState(false);
  const { width, height } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null),
    bottom = useRef(true),
    focused = useRef(false);
  const navigation = useNavigation();
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: !fullscreen });
  }, [navigation, fullscreen]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      bottom.current = true;
      const update = () =>
        runtime.chat.setView(
          tab === "chat" && AppState.currentState === "active",
          bottom.current,
        );
      update();
      if (tab === "chat")
        requestAnimationFrame(() =>
          scroll.current?.scrollToEnd({ animated: false }),
        );
      const listener = AppState.addEventListener("change", update);
      return () => {
        focused.current = false;
        listener.remove();
        runtime.chat.setView(false, true);
      };
    }, [tab]),
  );
  useEffect(
    () => () => {
      void Orientation.unlockAsync();
    },
    [],
  );
  const room = state.room;
  if (!room)
    return (
      <Page>
        <Text style={styles.title}>当前未加入房间</Text>
        <Button onPress={() => router.back()}>返回</Button>
      </Page>
    );
  const owner = room.ownerUserId === session.user?.id;
  const work = (operation: () => Promise<unknown>) =>
    action(async () => {
      await operation();
      await runtime.refresh();
    });
  const video = (
    <View
      style={{
        width: "100%",
        height: fullscreen ? height - 100 : Math.min(width * 0.56, 310),
        backgroundColor: "#07090f",
        borderRadius: 16,
        overflow: "hidden",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {media.video ? (
        <VideoTrack
          trackRef={media.video}
          objectFit="contain"
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <View style={{ alignItems: "center", padding: 20, gap: 14 }}>
          <Text style={styles.heading}>
            {media.sharer ? `${media.sharer} 正在共享` : "好戏，等你开场"}
          </Text>
          {media.sharer && !media.watching && (
            <Button
              primary
              testID="watch-join"
              onPress={() => runtime.media.watch(true)}
            >
              加入观看
            </Button>
          )}
          {media.watching && (
            <Label muted>
              {media.foreground ? "正在连接画面…" : "后台已暂停画面"}
            </Label>
          )}
        </View>
      )}
    </View>
  );
  if (fullscreen)
    return (
      <Page scroll={false} safeBottom>
        {video}
        <Button
          onPress={async () => {
            setFullscreen(false);
            await Orientation.unlockAsync();
          }}
        >
          返回房间
        </Button>
      </Page>
    );
  return (
    <Page scroll={false} safeBottom>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={90}
      >
        <ScrollView
          ref={scroll}
          scrollEventThrottle={100}
          onScroll={({ nativeEvent: e }) => {
            bottom.current =
              e.contentOffset.y + e.layoutMeasurement.height >=
              e.contentSize.height - 60;
            runtime.chat.setView(
              focused.current &&
                tab === "chat" &&
                AppState.currentState === "active",
              bottom.current,
            );
          }}
          onContentSizeChange={() => {
            if (tab === "chat" && bottom.current)
              scroll.current?.scrollToEnd({ animated: false });
          }}
          contentContainerStyle={{ padding: 16, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <MaintenanceBanner />
          <View style={styles.spread}>
            <Label muted>
              {room.code} {room.access === "password" ? "加密房" : "普通房"}
            </Label>
            <View style={styles.row}>
              {owner && (
                <Button
                  onPress={() => {
                    setName(room.name);
                    setMax(String(room.maxMembers));
                    setEditing(true);
                  }}
                >
                  房间设置
                </Button>
              )}
              <Button
                onPress={work(async () => {
                  const invite = await runtime.api.call("invite", (c) =>
                    c.POST("/api/v1/rooms/{roomId}/invites", {
                      params: { path: { roomId: room.id } },
                      body: { expiresInHours: 24, maxUses: 10 },
                    }),
                  );
                  await Share.share({
                    message: `加入映聚房间「${room.name}」\n${runtime.origin}/?room=${room.code}#invite=${invite.token}`,
                  });
                })}
              >
                邀请
              </Button>
            </View>
          </View>
          {video}
          <View style={styles.spread}>
            <Label muted>
              {media.reconnecting
                ? "正在重新连接…"
                : media.connected
                  ? "已连接"
                  : "连接中…"}
            </Label>
            {media.watching && (
              <View style={styles.row}>
                <Button onPress={() => runtime.media.watch(false)}>
                  暂停观看
                </Button>
                <Button
                  onPress={async () => {
                    setFullscreen(true);
                    await Orientation.lockAsync(
                      Orientation.OrientationLock.LANDSCAPE,
                    );
                  }}
                >
                  全屏
                </Button>
              </View>
            )}
          </View>
          <View style={styles.row}>
            <Button
              primary={media.microphone}
              testID="room-microphone"
              disabled={!media.microphoneAllowed}
              onPress={action(() => runtime.media.toggleMicrophone())}
            >
              {!media.microphoneAllowed
                ? "已禁止开麦"
                : media.microphone
                  ? "关闭麦克风"
                  : "开启麦克风"}
            </Button>
            <Button
              onPress={action(async () => {
                setOutputs(await runtime.media.outputs());
                setAudio(true);
              })}
            >
              ⌃
            </Button>
            <View style={{ flex: 1 }} />
            <Button
              danger
              onPress={action(async () => {
                await runtime.coordinator.leave();
                router.back();
              })}
            >
              退出房间
            </Button>
          </View>
          <View style={styles.row}>
            <Button
              primary={tab === "members"}
              onPress={() => setTab("members")}
            >
              成员 {media.members.length}/{room.maxMembers}
            </Button>
            <Button primary={tab === "chat"} onPress={() => setTab("chat")}>
              聊天{state.chat.unread ? ` (${state.chat.unread})` : ""}
            </Button>
          </View>
          {tab === "members" ? (
            media.members.map((member) => (
              <View key={member.id} style={[styles.card, styles.row]}>
                <Avatar name={member.name} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.heading}>
                    {member.name}
                    {member.id === room.ownerUserId ? " 房主" : ""}
                    {member.id === session.user?.id ? " 你" : ""}
                  </Text>
                  <Label muted>
                    {member.microphone
                      ? member.speaking
                        ? "正在说话"
                        : "麦克风已开启"
                      : "麦克风已关闭"}
                    {member.accompaniment ? " ♫ 伴奏中" : ""}
                  </Label>
                </View>
                {member.id !== session.user?.id && (
                  <Button
                    onPress={() => {
                      setSelected(member.id);
                      setMemberGain(runtime.media.memberGain(member.id));
                    }}
                  >
                    更多
                  </Button>
                )}
              </View>
            ))
          ) : (
            <View style={{ minHeight: 120, gap: 16 }}>
              {state.chat.items.map((message) => (
                <View key={message.id} style={{ gap: 4 }}>
                  <Label muted>
                    {message.displayName}
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Label>
                  <Label>{message.body}</Label>
                </View>
              ))}
              {!state.chat.items.length && (
                <Label muted>和房间里的朋友聊聊吧。</Label>
              )}
              {state.chat.failed && (
                <Button onPress={() => runtime.chat.sync()}>
                  重新加载消息
                </Button>
              )}
            </View>
          )}
        </ScrollView>
        {tab === "chat" && (
          <View
            style={{
              padding: 12,
              gap: 10,
              flexDirection: "row",
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <View style={{ flex: 1 }}>
              <Field
                placeholder="和朋友说点什么…"
                value={draft}
                onChangeText={setDraft}
                maxLength={2000}
              />
            </View>
            <Button
              primary
              disabled={!draft.trim()}
              onPress={action(async () => {
                await runtime.sendMessage(draft);
                setDraft("");
              })}
            >
              发送
            </Button>
          </View>
        )}
      </KeyboardAvoidingView>
      <Dialog visible={audio} title="音频" close={() => setAudio(false)}>
        <Label>语音音量 {Math.round(voice * 100)}%</Label>
        <Slider
          accessibilityLabel="语音音量"
          minimumValue={0}
          maximumValue={2}
          value={voice}
          onValueChange={(v) => {
            setVoice(v);
            runtime.media.setGain("voice", v);
          }}
        />
        <Label>共享音量 {Math.round(shared * 100)}%</Label>
        <Slider
          accessibilityLabel="共享音量"
          minimumValue={0}
          maximumValue={2}
          value={shared}
          onValueChange={(v) => {
            setShared(v);
            runtime.media.setGain("share", v);
          }}
        />
        <Label>输出设备</Label>
        {outputs.map((output) => (
          <Button
            key={output}
            onPress={action(() => runtime.media.selectOutput(output))}
          >
            {(
              {
                speaker: "扬声器",
                speakerphone: "扬声器",
                earpiece: "听筒",
                headset: "耳机",
                bluetooth: "蓝牙耳机",
                default: "系统选择 / 蓝牙设备",
                force_speaker: "扬声器",
              } as Record<string, string>
            )[output] ?? output}
          </Button>
        ))}
        <Label muted>已启用基础降噪与回声消除。</Label>
      </Dialog>
      <Dialog
        visible={editing}
        title="房间设置"
        close={() => setEditing(false)}
      >
        <Field label="房间名称" value={name} onChangeText={setName} />
        <Field
          label="人数上限（2–10）"
          value={max}
          onChangeText={setMax}
          keyboardType="number-pad"
        />
        <Button
          primary
          onPress={work(async () => {
            await runtime.api.call("room-settings", (c) =>
              c.POST("/api/v1/rooms/{roomId}/settings", {
                params: { path: { roomId: room.id } },
                body: { name, maxMembers: Number(max) },
              }),
            );
            setEditing(false);
          })}
        >
          保存
        </Button>
      </Dialog>
      <Dialog
        visible={!!selected}
        title="成员操作"
        close={() => setSelected(undefined)}
      >
        <Label>用户音量 {Math.round(memberGain * 100)}%</Label>
        <Slider
          accessibilityLabel="用户音量"
          minimumValue={0}
          maximumValue={2}
          value={memberGain}
          onValueChange={(value) => {
            setMemberGain(value);
            if (selected) runtime.media.setMemberGain(selected, value);
          }}
          onSlidingComplete={(value) => {
            if (
              state.friends.items.some(
                (f) => f.userId === selected && f.status === "accepted",
              )
            )
              void runtime.api
                .call("friend-volume", (c) =>
                  c.PATCH("/api/v1/friends/{userId}/preferences", {
                    params: { path: { userId: selected! } },
                    body: { volume: Math.round(value * 100) },
                  }),
                )
                .catch((e) => runtime.fail(e));
          }}
        />
        {owner && (
          <>
            <Button
              onPress={work(() =>
                runtime.api.call("mute-member", (c) =>
                  c.POST(
                    "/api/v1/rooms/{roomId}/members/{userId}/microphone/mute",
                    {
                      body: {},
                      params: { path: { roomId: room.id, userId: selected! } },
                    },
                  ),
                ),
              )}
            >
              关闭麦克风
            </Button>
            <Button
              onPress={work(() =>
                runtime.api.call("toggle-microphone-permission", (c) =>
                  c.POST(
                    "/api/v1/rooms/{roomId}/members/{userId}/permissions",
                    {
                      params: { path: { roomId: room.id, userId: selected! } },
                      body: {
                        microphoneAllowed:
                          room.memberPermissions?.find(
                            (p) => p.userId === selected,
                          )?.microphoneAllowed === false,
                      },
                    },
                  ),
                ),
              )}
            >
              {room.memberPermissions?.find((p) => p.userId === selected)
                ?.microphoneAllowed === false
                ? "允许开麦"
                : "禁止开麦"}
            </Button>
            <Button
              onPress={work(() =>
                runtime.api.call("stop-accompaniment", (c) =>
                  c.POST(
                    "/api/v1/rooms/{roomId}/members/{userId}/accompaniment/stop",
                    {
                      body: {},
                      params: { path: { roomId: room.id, userId: selected! } },
                    },
                  ),
                ),
              )}
            >
              关闭伴奏
            </Button>
            <Button
              onPress={work(async () => {
                await runtime.api.call("transfer-owner", (c) =>
                  c.POST("/api/v1/rooms/{roomId}/members/{userId}/owner", {
                    params: { path: { roomId: room.id, userId: selected! } },
                  }),
                );
                setSelected(undefined);
              })}
            >
              转移房主
            </Button>
            <Button
              danger
              onPress={work(async () => {
                await runtime.api.call("remove-member", (c) =>
                  c.DELETE("/api/v1/rooms/{roomId}/members/{userId}", {
                    params: { path: { roomId: room.id, userId: selected! } },
                    body: { ban: false },
                  }),
                );
                setSelected(undefined);
              })}
            >
              移出房间
            </Button>
          </>
        )}
      </Dialog>
    </Page>
  );
}
