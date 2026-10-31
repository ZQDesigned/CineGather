import { Pressable, Text } from "react-native";
import { router, useSegments } from "expo-router";
import { Info, ChevronRight } from "lucide-react-native";
import { useRuntime } from "./use-runtime";
import { colors } from "./ui";
export function MaintenanceBanner() {
  const { announcements } = useRuntime();
  const segments = useSegments();
  const notice = announcements.find(
    (a) => a.kind === "maintenance" && a.state === "active",
  );
  if (!notice) return null;
  return (
    <Pressable
      testID="maintenance-banner"
      accessibilityRole="button"
      accessibilityLabel={`${notice.title}，查看公告`}
      onPress={() => {
        if (segments[0] === "(tabs)") router.navigate("/(tabs)/notifications");
        else router.dismissTo("/(tabs)/notifications");
      }}
      style={{
        backgroundColor: "#29243a",
        marginHorizontal: 16,
        marginTop: 4,
        marginBottom: 4,
        paddingHorizontal: 12,
        minHeight: 36,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        borderRadius: 10,
      }}
    >
      <Info size={15} color={colors.accent} />
      <Text
        numberOfLines={1}
        style={{ flex: 1, color: colors.accent, fontSize: 12, lineHeight: 18 }}
      >
        {notice.title}
      </Text>
      <ChevronRight size={15} color={colors.accent} />
    </Pressable>
  );
}
