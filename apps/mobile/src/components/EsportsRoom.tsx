import { useCallback, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Switch,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import {
  RTCView,
  type MediaStream as NativeStream,
} from "@livekit/react-native-webrtc";
import { router, useFocusEffect } from "expo-router";
import {
  MonitorPlay,
  Mic,
  MicOff,
  ChevronUp,
  LogOut,
  UserPlus,
  MoreHorizontal,
  Settings2,
  Maximize,
  Minimize,
} from "lucide-react-native";
import { runtime } from "../runtime";
import { useRuntime, useMedia, useSession, action } from "./use-runtime";
import { Screen } from "./Screen";
import { ZoomableVideo } from "./ZoomableVideo";
import {
  Button,
  IconButton,
  Badge,
  Avatar,
  Field,
  Dialog,
  colors,
  styles,
} from "./ui";

/** Mobile is an audience client: all media rights are also checked by the API. */
export function EsportsRoom() {
  const state = useRuntime(),
    media = useMedia(),
    session = useSession();
  const [fullscreen, setFullscreen] = useState(false),
    [editing, setEditing] = useState(false),
    [name, setName] = useState("");
  const { width, height } = useWindowDimensions();
  useFocusEffect(
    useCallback(() => {
      runtime.media.setViewActive(true);
      return () => runtime.media.setViewActive(false);
    }, []),
  );
  const room = state.room,
    arena = state.esports,
    snapshot = arena?.snapshot;
  if (!room) return null;
  const owner = room.ownerUserId === session.user?.id;
  const source = snapshot?.publications.find((p) => p.id === arena?.watching);
  const player = snapshot?.members.find((m) => m.userId === source?.userId);
  const warm = media.warmingVideo;
  const video = (
    <View
      testID="esports-video"
      style={{
        backgroundColor: "#080b12",
        borderRadius: fullscreen ? 0 : 16,
        overflow: "hidden",
        ...(fullscreen
          ? { flex: 1 }
          : { height: Math.min(((width - 32) * 9) / 16, height * 0.4) }),
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {media.video ? (
        <ZoomableVideo
          key={media.video.publication.trackSid}
          trackRef={media.video}
        />
      ) : (
        <View style={{ alignItems: "center", gap: 10, padding: 20 }}>
          <MonitorPlay color={colors.accent} size={32} />
          <Text style={styles.text}>
            {arena?.busy ? "正在加载画面…" : "选择正在共享的选手画面"}
          </Text>
        </View>
      )}
      <View style={{ position: "absolute", right: 8, bottom: 8 }}>
        <IconButton
          icon={fullscreen ? Minimize : Maximize}
          label={fullscreen ? "退出全屏" : "全屏画面"}
          onPress={() => setFullscreen(!fullscreen)}
        />
      </View>
      {!!warm?.publication.track && (
        <RTCView
          key={warm.publication.trackSid}
          streamURL={
            (
              warm.publication.track.mediaStream as unknown as
                | NativeStream
                | undefined
            )?.toURL() ?? ""
          }
          objectFit="contain"
          style={{
            position: "absolute",
            width: 2,
            height: 2,
            left: 0,
            top: 0,
            opacity: 0.01,
          }}
          onDimensionsChange={({ nativeEvent }) =>
            runtime.media.acknowledgeFrame(
              warm.publication.trackSid,
              nativeEvent.width,
              nativeEvent.height,
            )
          }
        />
      )}
      {arena?.busy && media.video && (
        <Text
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            color: colors.text,
            backgroundColor: "#191d28dd",
            padding: 8,
            borderRadius: 8,
          }}
        >
          正在切换画面…
        </Text>
      )}
    </View>
  );
  if (fullscreen)
    return (
      <Screen
        title={player?.displayName ?? room.name}
        back={false}
        scroll={false}
        safeBottom
        currentRoom={false}
        contentStyle={{ flex: 1, padding: 0 }}
      >
        {video}
      </Screen>
    );
  return (
    <Screen
      title={room.name}
      back
      scroll={false}
      safeBottom
      currentRoom={false}
      contentStyle={{ flex: 1, padding: 0 }}
      actions={
        <>
          {owner && (
            <IconButton
              icon={Settings2}
              label="房间设置"
              onPress={() => {
                setName(room.name);
                setEditing(true);
              }}
            />
          )}
          <IconButton
            icon={UserPlus}
            label="邀请好友"
            onPress={() =>
              router.push({
                pathname: "/invite-friends",
                params: { roomId: room.id },
              })
            }
          />
        </>
      }
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 14 }}
      >
        <View style={styles.row}>
          <Badge tone="accent">电竞赛事房</Badge>
          <Text style={styles.muted}>
            观众席{" "}
            {snapshot?.members.filter((m) => m.seat.kind === "audience")
              .length ?? 0}
            /5
          </Text>
        </View>
        {video}
        {!!source && (
          <View style={[styles.card, { gap: 12 }]}>
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={[styles.text, { flex: 1 }]}>
                {player?.displayName} 的画面
              </Text>
              <Button
                quiet
                onPress={action(() => runtime.media.coordinator.stopWatching())}
              >
                停止观看
              </Button>
            </View>
            <View style={[styles.row, { justifyContent: "space-between" }]}>
              <Text style={[styles.text, { flex: 1 }]}>自动收听选手组语音</Text>
              <Switch
                accessibilityLabel="自动收听选手组语音"
                value={snapshot?.watch.autoMonitor ?? true}
                onValueChange={(value) => {
                  void runtime.media.coordinator
                    .monitor({ autoMonitor: value })
                    .catch((e) => runtime.fail(e));
                }}
              />
            </View>
            <Button
              quiet
              onPress={action(() =>
                runtime.media.coordinator.monitor({
                  enabled: !snapshot?.watch.monitorTeam,
                }),
              )}
            >
              {snapshot?.watch.monitorTeam
                ? `断开 ${snapshot.watch.monitorTeam.toUpperCase()} 组语音`
                : "收听选手组语音"}
            </Button>
          </View>
        )}
        {(["a", "b"] as const).map((team) => (
          <View key={team} style={[styles.card, { gap: 10 }]}>
            <Text style={styles.heading}>{team.toUpperCase()} 组</Text>
            {snapshot?.members
              .filter((m) => m.seat.kind === "player" && m.seat.team === team)
              .map((member) => {
                const publication = snapshot.publications.find(
                    (p) => p.userId === member.userId,
                  ),
                  selected = publication?.id === arena?.watching;
                return (
                  <View key={member.userId} style={[styles.row, { gap: 10 }]}>
                    <Avatar name={member.displayName} size={32} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={styles.text}>
                        {member.displayName}
                      </Text>
                      <Text style={styles.muted}>
                        {!member.online
                          ? "离线"
                          : !publication
                            ? "未共享"
                            : publication.status === "starting"
                              ? "正在准备共享"
                              : "正在共享"}
                      </Text>
                    </View>
                    {publication && (
                      <Button
                        quiet
                        disabled={
                          !member.online || arena?.warming === publication.id
                        }
                        onPress={action(() =>
                          runtime.media.coordinator.select(publication.id),
                        )}
                      >
                        {selected
                          ? "正在观看"
                          : arena?.warming === publication.id
                            ? "切换中"
                            : "观看"}
                      </Button>
                    )}
                  </View>
                );
              })}
            {!snapshot?.members.some(
              (m) => m.seat.kind === "player" && m.seat.team === team,
            ) && <Text style={styles.muted}>暂无选手</Text>}
          </View>
        ))}
        <View style={[styles.card, { gap: 12 }]}>
          <Text style={styles.heading}>
            房间成员 {snapshot?.members.filter((m) => m.online).length ?? 0}/20
          </Text>
          {snapshot?.members.map((member) => {
            const sound = media.members.find((m) => m.id === member.userId);
            return (
              <View key={member.userId} style={[styles.row, { gap: 10 }]}>
                <Avatar name={member.displayName} size={36} />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text numberOfLines={1} style={styles.text}>
                    {member.displayName}
                    {member.userId === session.user?.id ? "（你）" : ""}
                  </Text>
                  <Text
                    style={[
                      styles.muted,
                      sound?.speaking && { color: colors.green },
                    ]}
                  >
                    {member.seat.kind === "player"
                      ? `${member.seat.team.toUpperCase()} 组选手`
                      : member.seat.kind === "director"
                        ? "导播席"
                        : "观众席"}
                    {!member.online
                      ? "，离线"
                      : sound?.speaking
                        ? "，正在说话"
                        : ""}
                  </Text>
                </View>
                {member.userId === room.ownerUserId && <Badge>房主</Badge>}
                {member.online && member.userId !== session.user?.id && (
                  <IconButton
                    icon={MoreHorizontal}
                    label={`${member.displayName}的成员操作`}
                    onPress={() =>
                      router.push({
                        pathname: "/member-options",
                        params: { roomId: room.id, userId: member.userId },
                      })
                    }
                  />
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
      <View
        testID="esports-room-footer"
        style={[
          styles.row,
          {
            padding: 12,
            borderTopColor: colors.border,
            borderTopWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <Button
          quiet
          icon={media.microphone ? Mic : MicOff}
          disabled={!media.microphoneAllowed || !snapshot}
          onPress={action(() => runtime.media.toggleMicrophone())}
          style={{ flex: 1 }}
        >
          {media.microphone ? "关闭麦克风" : "开启麦克风"}
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
        <IconButton
          icon={LogOut}
          danger
          label="退出房间"
          onPress={action(async () => {
            await runtime.coordinator.leave();
            router.replace("/");
          })}
        />
      </View>
      <Dialog
        visible={editing}
        title="房间设置"
        close={() => setEditing(false)}
      >
        <Field label="房间名称" value={name} onChangeText={setName} />
        <Button
          primary
          onPress={action(async () => {
            await runtime.api.call("room-settings", (c) =>
              c.POST("/api/v1/rooms/{roomId}/settings", {
                params: { path: { roomId: room.id } },
                body: { name },
              }),
            );
            await runtime.refresh();
            setEditing(false);
          })}
        >
          保存
        </Button>
      </Dialog>
    </Screen>
  );
}
