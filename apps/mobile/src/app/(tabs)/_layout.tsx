import { Tabs, router } from "expo-router";
import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Film, Users, Bell, Settings } from "lucide-react-native";
import { colors, styles, Button } from "../../components/ui";
import { useRuntime, action } from "../../components/use-runtime";
import { runtime } from "../../runtime";
export default function TabsLayout() {
  const state = useRuntime();
  const pending = state.friends.items.filter(
    (f) => f.status === "pending" && f.incoming,
  ).length;
  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      {state.room && (
        <View
          style={{
            padding: 12,
            backgroundColor: colors.surface,
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Pressable style={{ flex: 1 }} onPress={() => router.push("/room")}>
            <Text numberOfLines={1} style={{ color: colors.accent }}>
              正在房间：{state.room.name} 返回 ›
            </Text>
          </Pressable>
          <Button danger onPress={action(() => runtime.coordinator.leave())}>
            退出
          </Button>
        </View>
      )}
      <Tabs
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
          },
          tabBarActiveTintColor: colors.accent,
          tabBarInactiveTintColor: colors.muted,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "放映厅",
            tabBarIcon: ({ color }) => <Film color={color} size={22} />,
          }}
        />
        <Tabs.Screen
          name="friends"
          options={{
            title: "好友",
            tabBarBadge: pending || undefined,
            tabBarIcon: ({ color }) => <Users color={color} size={22} />,
          }}
        />
        <Tabs.Screen
          name="notifications"
          options={{
            title: "通知",
            tabBarIcon: ({ color }) => <Bell color={color} size={22} />,
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: "设置",
            tabBarIcon: ({ color }) => <Settings color={color} size={22} />,
          }}
        />
      </Tabs>
    </SafeAreaView>
  );
}
