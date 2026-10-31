import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import { useRuntime } from "./use-runtime";
import { colors } from "./ui";
export function MaintenanceBanner() {
  const { announcements } = useRuntime();
  const notice = announcements.find(
    (a) => a.kind === "maintenance" && a.state === "active",
  );
  if (!notice) return null;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push("/notifications")}
      style={{
        backgroundColor: "#30283e",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 10,
      }}
    >
      <Text numberOfLines={2} style={{ color: colors.accent, fontSize: 14 }}>
        {notice.title} 查看公告 ›
      </Text>
    </Pressable>
  );
}
