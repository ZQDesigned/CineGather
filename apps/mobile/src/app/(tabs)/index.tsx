import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useRuntime, useSession, action } from "../../components/use-runtime";
import {
  Page,
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
    <Page>
      <Text style={styles.title}>你好，{session.user?.displayName}</Text>
      <View style={styles.card}>
        <Text style={styles.title}>好时光，值得一起看。</Text>
        <View style={styles.row}>
          <Button
            primary
            onPress={() => {
              setPassword("");
              setDialog("create");
            }}
          >
            创建房间
          </Button>
          <Button
            onPress={() => {
              setPassword("");
              setDialog("join");
            }}
          >
            加入房间
          </Button>
        </View>
      </View>
      <View style={styles.spread}>
        <Text style={styles.heading}>你的房间</Text>
        <Button onPress={action(() => runtime.refresh())}>刷新</Button>
      </View>
      {state.rooms.map((room) => (
        <View key={room.id} style={styles.card}>
          <Text style={styles.heading}>{room.name}</Text>
          <Label muted>
            {room.access === "password" ? "加密房" : "普通房"} {room.code}
            最多 {room.maxMembers} 人
          </Label>
          <Button
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
    </Page>
  );
}
