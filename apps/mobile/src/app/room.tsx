import {
  useEffect,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import {
  View,
  Text,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
  AppState,
  Keyboard,
  Pressable,
  StyleSheet,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ZoomableVideo } from "../components/ZoomableVideo";
import * as Orientation from "expo-screen-orientation";
import {
  MonitorPlay,
  MonitorUp,
  Square,
  Mic,
  MicOff,
  ChevronUp,
  LogOut,
  MoreHorizontal,
  Settings2,
  UserPlus,
  Pause,
  Maximize,
  Minimize,
  Music2,
  MessageCircle,
  Send,
  Wifi,
} from "lucide-react-native";
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
  IconButton,
  Badge,
  EmptyState,
} from "../components/ui";
import { Screen } from "../components/Screen";
export default function RoomScreen() {
  const state = useRuntime(),
    media = useMedia(),
    session = useSession(),
    insets = useSafeAreaInsets();
  const [tab, setTab] = useState<"members" | "chat">("members"),
    [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(""),
    [max, setMax] = useState("5");
  const [fullscreen, setFullscreen] = useState(false),
    [keyboard, setKeyboard] = useState(false),
    [keyboardY, setKeyboardY] = useState<number>();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const compactTyping = landscape && keyboard && tab === "chat";
  const scroll = useRef<ScrollView>(null),
    bottom = useRef(true),
    focused = useRef(false);
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
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
      (event) => {
        const visible =
          event.endCoordinates.height > 0 &&
          (Platform.OS !== "ios" || event.endCoordinates.screenY < height);
        setKeyboard(visible);
        setKeyboardY(visible ? event.endCoordinates.screenY : undefined);
      },
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => {
        setKeyboard(false);
        setKeyboardY(undefined);
      },
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [height]);
  useEffect(
    () => () => {
      void Orientation.unlockAsync();
    },
    [],
  );
  const room = state.room;
  if (!room)
    return (
      <Screen title="房间" back safeBottom currentRoom={false}>
        <EmptyState icon={MonitorPlay} title="当前未加入房间" />
        <Button onPress={() => router.replace("/")}>返回放映厅</Button>
      </Screen>
    );
  const owner = room.ownerUserId === session.user?.id;
  const work = (operation: () => Promise<unknown>) =>
    action(async () => {
      await operation();
      await runtime.refresh();
    });
  const video = (
    <View
      testID="video-frame"
      style={{
        width: "100%",
        ...(fullscreen
          ? { flex: 1 }
          : landscape
            ? { flex: 1, minHeight: 0 }
            : {
                height:
                  keyboard && tab === "chat"
                    ? 96
                    : Math.min(((width - 32) * 9) / 16, height * 0.42),
              }),
        backgroundColor: "#080b12",
        borderRadius: fullscreen ? 0 : 16,
        overflow: "hidden",
        justifyContent: "center",
        alignItems: "center",
        borderWidth: fullscreen ? 0 : StyleSheet.hairlineWidth,
        borderColor: colors.border,
      }}
    >
      {media.video ? (
        <ZoomableVideo
          key={`${media.video.publication.trackSid}:${media.video.publication.track?.mediaStreamTrack.id}`}
          trackRef={media.video}
        />
      ) : (
        <View style={{ alignItems: "center", padding: 16, gap: 12 }}>
          {!(keyboard && tab === "chat") && (
            <MonitorPlay size={32} color={colors.muted} />
          )}
          <Text
            numberOfLines={2}
            style={[styles.heading, { textAlign: "center" }]}
          >
            {state.shareState === "active"
              ? "你正在共享屏幕"
              : !["idle", "failed"].includes(state.shareState)
                ? "正在准备共享…"
                : media.sharer
                  ? `${media.sharer} 正在共享`
                  : "当前暂无共享"}
          </Text>
          {media.sharer &&
            !media.watching &&
            ["idle", "failed"].includes(state.shareState) && (
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
      <Page scroll={false} safeTop safeBottom>
        {video}
        <View
          style={{
            position: "absolute",
            top: insets.top + 8,
            right: insets.right + 12,
            backgroundColor: "#191d28cc",
            borderRadius: 13,
          }}
        >
          <IconButton
            icon={Minimize}
            label="返回房间"
            onPress={async () => {
              setFullscreen(false);
              await Orientation.unlockAsync();
            }}
          />
        </View>
      </Page>
    );
  return (
    <Screen
      title={room.name}
      back
      scroll={false}
      safeBottom
      currentRoom={false}
      actions={
        <>
          {owner && (
            <IconButton
              icon={Settings2}
              label="房间设置"
              onPress={() => {
                setName(room.name);
                setMax(String(room.maxMembers));
                setEditing(true);
              }}
            />
          )}
          <IconButton
            icon={UserPlus}
            label="邀请好友"
            testID="room-invite-friends"
            onPress={() => {
              router.push({
                pathname: "/invite-friends",
                params: { roomId: room.id },
              });
              void runtime.refresh().catch((e) => runtime.fail(e));
            }}
          />
        </>
      }
    >
      <RoomKeyboard
        bottomInset={
          keyboardY === undefined
            ? 0
            : Math.max(0, height - insets.bottom - keyboardY)
        }
      >
        <View
          key={landscape ? "landscape" : "portrait"}
          style={{
            flex: 1,
            flexBasis: 0,
            minHeight: 0,
            flexDirection: landscape ? "row" : "column",
          }}
        >
          <View
            style={{
              ...(landscape ? { flex: 1, minWidth: 0 } : {}),
              display: compactTyping ? "none" : "flex",
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 8,
              gap: 6,
            }}
          >
            {video}
            {!(keyboard && tab === "chat") && (
              <View style={[styles.spread, { minHeight: 36 }]}>
                <View style={[styles.row, { gap: 8, flex: 1 }]}>
                  <Badge>
                    {room.access === "password" ? "加密房" : "普通房"}
                  </Badge>
                  <Label muted>{room.code}</Label>
                  <Wifi
                    size={12}
                    color={media.connected ? colors.green : colors.muted}
                  />
                </View>
                {media.watching && (
                  <View style={{ flexDirection: "row" }}>
                    <IconButton
                      icon={Pause}
                      label="暂停观看"
                      onPress={() => runtime.media.watch(false)}
                    />
                    <IconButton
                      icon={Maximize}
                      label="全屏画面"
                      onPress={async () => {
                        setFullscreen(true);
                        await Orientation.lockAsync(
                          Orientation.OrientationLock.LANDSCAPE,
                        );
                      }}
                    />
                  </View>
                )}
                {media.reconnecting && <Label muted>重新连接中</Label>}
              </View>
            )}
          </View>
          <View
            style={{
              ...(landscape && !compactTyping
                ? { width: "44%", height: "100%" }
                : { flex: 1, flexBasis: 0 }),
              minHeight: 0,
              minWidth: 0,
            }}
          >
            <View
              style={{
                marginHorizontal: 16,
                flexDirection: "row",
                gap: 4,
                padding: 4,
                borderRadius: 12,
                backgroundColor: colors.surface,
              }}
            >
              {(["members", "chat"] as const).map((value) => (
                <Pressable
                  key={value}
                  testID={`room-tab-${value}`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: tab === value }}
                  onPress={() => {
                    setTab(value);
                    if (value === "members") Keyboard.dismiss();
                  }}
                  style={{
                    flex: 1,
                    minHeight: 36,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                    gap: 8,
                    borderRadius: 9,
                    backgroundColor:
                      tab === value ? colors.raised : "transparent",
                  }}
                >
                  <Text
                    style={[
                      styles.text,
                      {
                        fontWeight: "600",
                        color: tab === value ? colors.text : colors.muted,
                      },
                    ]}
                  >
                    {value === "members"
                      ? `成员 ${media.members.length}/${room.maxMembers}`
                      : "聊天"}
                  </Text>
                  {value === "chat" && state.chat.unread > 0 && (
                    <Badge tone="accent">{state.chat.unread}</Badge>
                  )}
                </Pressable>
              ))}
            </View>
            <ScrollView
              ref={scroll}
              testID="room-list"
              style={{ flex: 1, flexBasis: 0, minHeight: 0 }}
              automaticallyAdjustContentInsets={false}
              contentInsetAdjustmentBehavior="never"
              keyboardShouldPersistTaps="handled"
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
              contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
            >
              {tab === "members" ? (
                media.members.map((member) => (
                  <View
                    key={member.id}
                    style={[styles.card, styles.row, { padding: 12 }]}
                  >
                    <Avatar name={member.name} size={40} />
                    <View style={{ flex: 1, gap: 4 }}>
                      <View style={[styles.row, { gap: 6 }]}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.heading,
                            { flexShrink: 1, fontSize: 15 },
                          ]}
                        >
                          {member.name}
                        </Text>
                        {member.id === room.ownerUserId && (
                          <Badge tone="accent">房主</Badge>
                        )}
                        {member.id === session.user?.id && <Badge>你</Badge>}
                      </View>
                      <View style={[styles.row, { gap: 6 }]}>
                        {member.microphone ? (
                          <Mic
                            size={12}
                            color={
                              member.speaking ? colors.green : colors.muted
                            }
                          />
                        ) : (
                          <MicOff size={12} color={colors.muted} />
                        )}
                        <Text
                          style={[
                            styles.muted,
                            member.speaking && { color: colors.green },
                          ]}
                        >
                          {member.microphone
                            ? member.speaking
                              ? "正在说话"
                              : "语音已就绪"
                            : "麦克风已关闭"}
                        </Text>
                      </View>
                    </View>
                    {member.accompaniment && (
                      <View
                        accessibilityLabel="伴奏播放中"
                        style={{
                          padding: 7,
                          borderRadius: 10,
                          backgroundColor: "#302943",
                        }}
                      >
                        <Music2 size={16} color={colors.accent} />
                      </View>
                    )}
                    {member.id !== session.user?.id && (
                      <IconButton
                        icon={MoreHorizontal}
                        label={`${member.name}的成员操作`}
                        onPress={() => {
                          router.push({
                            pathname: "/member-options",
                            params: { roomId: room.id, userId: member.id },
                          });
                        }}
                      />
                    )}
                  </View>
                ))
              ) : (
                <>
                  {state.chat.items.map((message) => (
                    <View
                      key={message.id}
                      style={{
                        alignItems:
                          message.userId === session.user?.id
                            ? "flex-end"
                            : "flex-start",
                        gap: 4,
                      }}
                    >
                      <Text style={styles.muted}>
                        {message.displayName}{" "}
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Text>
                      <View
                        style={{
                          maxWidth: "88%",
                          paddingHorizontal: 12,
                          paddingVertical: 9,
                          borderRadius: 13,
                          backgroundColor:
                            message.userId === session.user?.id
                              ? "#302943"
                              : colors.surface,
                        }}
                      >
                        <Text selectable style={styles.text}>
                          {message.body}
                        </Text>
                      </View>
                    </View>
                  ))}
                  {!state.chat.items.length && (
                    <View style={{ flex: 1, justifyContent: "center" }}>
                      <EmptyState icon={MessageCircle} title="还没有聊天消息" />
                    </View>
                  )}
                  {state.chat.failed && (
                    <Button onPress={() => runtime.chat.sync()}>
                      重新加载消息
                    </Button>
                  )}
                </>
              )}
            </ScrollView>
            {tab === "chat" && (
              <View
                testID="chat-composer"
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  gap: 8,
                  flexDirection: "row",
                  alignItems: "center",
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Field
                    testID="chat-input"
                    autoFocus={keyboard}
                    placeholder="和朋友说点什么…"
                    value={draft}
                    onChangeText={setDraft}
                    maxLength={2000}
                  />
                </View>
                <IconButton
                  icon={Send}
                  label="发送消息"
                  active
                  disabled={!draft.trim()}
                  onPress={action(async () => {
                    await runtime.sendMessage(draft);
                    setDraft("");
                  })}
                />
              </View>
            )}
          </View>
        </View>
        {!compactTyping && (
          <View style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
            <Button
              icon={
                ["idle", "failed"].includes(state.shareState)
                  ? MonitorUp
                  : Square
              }
              primary={state.shareState === "active"}
              testID="room-share-screen"
              onPress={
                ["idle", "failed"].includes(state.shareState)
                  ? () =>
                      router.push({
                        pathname: "/share-screen",
                        params: { roomId: room.id },
                      })
                  : action(() => runtime.sharing.stop())
              }
            >
              {["idle", "failed"].includes(state.shareState)
                ? "共享屏幕"
                : "停止共享"}
            </Button>
          </View>
        )}
        {!compactTyping && (
          <View
            testID="room-controls"
            style={{
              paddingHorizontal: 16,
              paddingVertical: 10,
              flexDirection: "row",
              gap: 12,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: colors.border,
              backgroundColor: colors.bg,
            }}
          >
            <View
              style={{
                flex: 1,
                flexDirection: "row",
                alignItems: "center",
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 13,
                overflow: "hidden",
                backgroundColor: colors.raised,
              }}
            >
              <Button
                primary={media.microphone}
                icon={media.microphone ? Mic : MicOff}
                testID="room-microphone"
                disabled={!media.microphoneAllowed}
                style={{
                  flex: 1,
                  height: 48,
                  borderWidth: 0,
                  borderRadius: 0,
                  paddingHorizontal: 8,
                }}
                onPress={action(() => runtime.media.toggleMicrophone())}
              >
                {!media.microphoneAllowed
                  ? "已禁止开麦"
                  : media.microphone
                    ? "关闭麦克风"
                    : "开启麦克风"}
              </Button>
              <IconButton
                icon={ChevronUp}
                label="音频与输出设备"
                onPress={() =>
                  router.push({
                    pathname: "/audio-options",
                    params: { roomId: room.id },
                  })
                }
              />
            </View>
            <Button
              quiet
              danger
              icon={LogOut}
              style={{ height: 50, paddingHorizontal: 8 }}
              onPress={action(async () => {
                await runtime.coordinator.leave();
                if (router.canGoBack()) router.back();
                else router.replace("/");
              })}
            >
              退出房间
            </Button>
          </View>
        )}
      </RoomKeyboard>
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
    </Screen>
  );
}

// iOS keyboard frames are screen coordinates. Subtract the one bottom safe inset
// already owned by Screen; another header offset would count the safe area twice.
function RoomKeyboard({
  children,
  bottomInset,
}: {
  children: ReactNode;
  bottomInset: number;
}) {
  if (Platform.OS === "ios")
    return (
      <View style={{ flex: 1, paddingBottom: bottomInset }}>{children}</View>
    );
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      {children}
    </KeyboardAvoidingView>
  );
}
