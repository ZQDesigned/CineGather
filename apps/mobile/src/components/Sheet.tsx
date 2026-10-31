import { type ReactNode } from "react";
import { ScrollView, View, Text, Pressable, Platform } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { IconButton, Label, colors, styles } from "./ui";
import { useRuntime } from "./use-runtime";
import { runtime } from "../runtime";

// Opt individual routes into native presentation; centered Dialog remains available.
export const nativeSheetOptions = {
  presentation: "formSheet" as const,
  headerShown: false,
  gestureEnabled: true,
  sheetAllowedDetents: [0.6, 1],
  sheetInitialDetentIndex: 0,
  sheetGrabberVisible: true,
  sheetCornerRadius: 26,
  contentStyle: { backgroundColor: colors.surface },
};

export function closeSheet() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

export function useSheetRoom() {
  const state = useRuntime();
  const { roomId } = useLocalSearchParams<{ roomId?: string }>();
  return state.roomState === "connected" && state.room?.id === roomId
    ? state.room
    : undefined;
}

export function Sheet({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const state = useRuntime();
  return (
    <ScrollView
      testID="native-sheet"
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{
        paddingHorizontal: 18,
        paddingTop: Platform.OS === "ios" ? 20 : 12,
        paddingBottom: Math.max(insets.bottom, 16),
        gap: 16,
      }}
    >
      <View style={styles.spread}>
        <Text accessibilityRole="header" style={[styles.heading, { flex: 1 }]}>
          {title}
        </Text>
        <IconButton icon={X} label="关闭面板" onPress={closeSheet} />
      </View>
      {state.error && (
        <Pressable
          accessibilityRole="alert"
          onPress={() => runtime.clearError()}
          style={{ backgroundColor: "#492735", padding: 12, borderRadius: 12 }}
        >
          <Text style={styles.text}>{state.error}</Text>
        </Pressable>
      )}
      {children}
    </ScrollView>
  );
}

export function UnavailableSheet() {
  return (
    <Sheet title="操作已结束">
      <Label muted>房间或成员状态已改变，请关闭面板后重试。</Label>
    </Sheet>
  );
}
