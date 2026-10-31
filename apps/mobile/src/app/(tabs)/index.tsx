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
  Label,
} from "../../components/ui";
import { runtime } from "../../runtime";
export default function Lobby() {
  const state = useRuntime(),
    session = useSession();
  const enter = async (input: string) => {
    if (await runtime.join(input)) router.push("/room");
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
            onPress={() => router.push("/create-room")}
          >
            创建房间
          </Button>
          <Button
            icon={LogIn}
            style={{ flex: 1 }}
            onPress={() => router.push("/join-room")}
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
                router.push({
                  pathname: "/join-room",
                  params: { code: room.code },
                });
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
    </Screen>
  );
}
