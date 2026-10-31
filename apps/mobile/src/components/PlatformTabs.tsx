import { type ComponentProps } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Film, Users, Bell, Settings } from "lucide-react-native";
import { colors } from "./ui";
import { useRuntime } from "./use-runtime";

type BarProps = Parameters<
  NonNullable<ComponentProps<typeof Tabs>["tabBar"]>
>[0];
const icons = {
  index: Film,
  friends: Users,
  notifications: Bell,
  settings: Settings,
};
function TabBar({ state, descriptors, navigation }: BarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      testID="android-tab-bar"
      style={{
        flexDirection: "row",
        backgroundColor: colors.bg,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
        paddingTop: 6,
        paddingBottom: Math.max(insets.bottom, 8),
        paddingHorizontal: 8,
      }}
    >
      {state.routes.map((route, index) => {
        const options = descriptors[route.key]?.options ?? {};
        const selected = state.index === index;
        const Icon = icons[route.name as keyof typeof icons] ?? Film;
        const label = options.title ?? route.name;
        const badge = options.tabBarBadge;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            testID={`tab-${route.name}`}
            onPress={() => {
              const event = navigation.emit({
                type: "tabPress",
                target: route.key,
                canPreventDefault: true,
              });
              if (!selected && !event.defaultPrevented)
                navigation.navigate(route.name, route.params);
            }}
            onLongPress={() =>
              navigation.emit({ type: "tabLongPress", target: route.key })
            }
            style={{
              flex: 1,
              minHeight: 52,
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
            }}
          >
            <View
              style={{
                width: 52,
                height: 28,
                borderRadius: 14,
                justifyContent: "center",
                alignItems: "center",
                backgroundColor: selected ? colors.raised : "transparent",
              }}
            >
              <Icon size={21} color={selected ? colors.accent : colors.muted} />
              {badge !== undefined && (
                <View
                  style={{
                    position: "absolute",
                    right: 0,
                    top: -3,
                    minWidth: 16,
                    height: 16,
                    paddingHorizontal: 4,
                    borderRadius: 8,
                    backgroundColor: "#d84e64",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{ color: "#fff", fontSize: 10, fontWeight: "600" }}
                  >
                    {typeof badge === "number" && badge > 99 ? "99+" : badge}
                  </Text>
                </View>
              )}
            </View>
            <Text
              numberOfLines={1}
              style={{
                fontSize: 11,
                fontWeight: selected ? "600" : "400",
                color: selected ? colors.accent : colors.muted,
              }}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
export function PlatformTabs() {
  const state = useRuntime();
  const pending = state.friends.items.filter(
    (f) => f.status === "pending" && f.incoming,
  ).length;
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: "放映厅" }} />
      <Tabs.Screen
        name="friends"
        options={{ title: "好友", tabBarBadge: pending || undefined }}
      />
      <Tabs.Screen name="notifications" options={{ title: "通知" }} />
      <Tabs.Screen name="settings" options={{ title: "设置" }} />
    </Tabs>
  );
}
