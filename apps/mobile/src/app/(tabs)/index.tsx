import { useState } from "react";
import { Text, View } from "react-native";
import { Film, Plus, LogIn, RefreshCw } from "lucide-react-native";
import { Screen } from "../../components/Screen";
import { router } from "expo-router";
import { useRuntime, useSession, action } from "../../components/use-runtime";
import {
  Avatar,
  Badge,
  IconButton,
  SectionHeading,
  EmptyState,
  styles,
  Button,
  Field,
  Dialog,
  Label,
} from "../../components/ui";
import { runtime } from "../../runtime";
export default function Lobby() {
  const state = useRuntime(),
    session = useSession();
  const [dialog, setDialog] = useState<"create" | "join">(),
    [name, setName] = useState("今晚一起看"),
    [code, setCode] = useState(""),
    [password, setPassword] = useState(""),
    [max, setMax] = useState("5");
  const enter = async (input: string) => {
    await runtime.join(input, password || undefined);
    if (runtime.snapshot().roomState === "connected") {
      setDialog(undefined);
      router.push("/room");
    }
  };
  return (
    <Screen
      title="放映厅"
      actions={
        <IconButton
          icon={RefreshCw}
          label="刷新房间"
          onPress={action(() => runtime.refresh())}
        />
      }
      contentStyle={{ flexGrow: 1 }}
    >
      <View style={[styles.spread, { paddingVertical: 8 }]}>
        <View style={{ flex: 1, gap: 3 }}>
          <Label muted>欢迎回来</Label>
          <Text numberOfLines={1} style={styles.title}>
            {session.user?.displayName}
          </Text>
        </View>
        <Avatar name={session.user?.displayName ?? "映"} size={48} />
      </View>
      <View style={styles.card}>
        <View style={styles.row}>
          <Film size={20} color="#b4a0f4" />
          <Text style={styles.heading}>开始相聚</Text>
        </View>
        <View style={styles.row}>
          <Button
            primary
            icon={Plus}
            style={{ flex: 1 }}
            onPress={() => {
              setPassword("");
              setDialog("create");
            }}
          >
            创建房间
          </Button>
          <Button
            icon={LogIn}
            style={{ flex: 1 }}
            onPress={() => {
              setPassword("");
              setDialog("join");
            }}
          >
            加入房间
          </Button>
        </View>
      </View>
      <SectionHeading title="你的房间" count={state.rooms.length} />
      {state.rooms.map((room) => (
        <View key={room.id} style={styles.card}>
          <Text numberOfLines={2} style={styles.heading}>
            {room.name}
          </Text>
          <View style={styles.spread}>
            <View style={styles.row}>
              <Badge>{room.access === "password" ? "加密房" : "普通房"}</Badge>
              <Label muted>{room.code}</Label>
            </View>
            <Label muted>最多 {room.maxMembers} 人</Label>
          </View>
          <Button
            icon={LogIn}
            onPress={action(async () => {
              if (state.room?.id === room.id) router.push("/room");
              else if (room.access === "password") {
                setCode(room.code);
                setPassword("");
                setDialog("join");
              } else await enter(room.id);
            })}
          >
            进入房间
          </Button>
        </View>
      ))}
      {!state.rooms.length && (
        <View style={{ flex: 1, justifyContent: "center", maxHeight: 240 }}>
          <EmptyState
            icon={Film}
            title="还没有房间"
            detail="创建房间，或用房间号加入"
          />
        </View>
      )}
      <Dialog
        visible={!!dialog}
        title={dialog === "create" ? "创建房间" : "加入房间"}
        close={() => setDialog(undefined)}
      >
        {dialog === "create" ? (
          <>
            <Field
              label="房间名称"
              value={name}
              onChangeText={setName}
              maxLength={64}
            />
            <Field
              label="人数上限（2–10）"
              value={max}
              onChangeText={setMax}
              keyboardType="number-pad"
            />
          </>
        ) : (
          <Field
            label="房间号或邀请链接"
            testID="join-code"
            value={code}
            onChangeText={setCode}
            autoCapitalize="none"
          />
        )}
        <Field
          label={
            dialog === "create"
              ? "房间密码（留空为普通房）"
              : "房间密码（如需）"
          }
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <Button
          primary
          onPress={action(async () => {
            if (dialog === "create") {
              await runtime.create(name, Number(max), password || undefined);
              if (runtime.snapshot().roomState === "connected") {
                setDialog(undefined);
                router.push("/room");
              }
            } else await enter(code);
          })}
        >
          {dialog === "create" ? "创建并加入" : "加入房间"}
        </Button>
      </Dialog>
    </Screen>
  );
}
