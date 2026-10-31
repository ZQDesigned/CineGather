import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ScrollView,
  View,
  Text,
  Platform,
  Keyboard,
  type KeyboardEvent,
} from "react-native";
import {
  Stack,
  router,
  useLocalSearchParams,
  useFocusEffect,
} from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { IconButton, Label, colors, styles } from "./ui";
import { useRuntime } from "./use-runtime";
import { SnackbarHost } from "./Snackbar";

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
  footer,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  // Native form sheets use a local origin; reserve keyboard height from the
  // shared screen bottom instead of mixing local and screen Y coordinates.
  const [keyboardHeight, setKeyboardHeight] = useState(
    Keyboard.metrics()?.height ?? 0,
  );
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const update = (event: KeyboardEvent) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardHeight(event.endCoordinates.height);
    };
    const show = Keyboard.addListener("keyboardWillShow", update);
    const hide = Keyboard.addListener("keyboardWillHide", (event) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const [footerHeight, setFooterHeight] = useState(0);
  const nativeFooter = Platform.OS === "android";
  const footerView = (
    <View
      testID="native-sheet-footer"
      onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
      style={{
        backgroundColor: colors.surface,
        paddingBottom: Math.max(insets.bottom, 16),
      }}
    >
      <SnackbarHost priority={10} enabled={focused} inline />
      {footer && (
        <View
          style={{
            paddingHorizontal: 18,
            paddingTop: 12,
            borderTopWidth: 0.5,
            borderTopColor: colors.border,
          }}
        >
          {footer}
        </View>
      )}
    </View>
  );
  return (
    <>
      {nativeFooter && (
        <Stack.Screen
          options={{
            // Android lays out sheet content at its largest detent. Let the
            // native footer follow the visible edge during dragging and IME changes.
            unstable_sheetFooter: () => footerView,
          }}
        />
      )}
      <View
        testID="native-sheet-container"
        collapsable={false}
        style={{
          flex: 1,
          backgroundColor: colors.surface,
          paddingBottom: Platform.OS === "ios" ? keyboardHeight : 0,
        }}
      >
        <ScrollView
          testID="native-sheet"
          style={{ flex: 1, backgroundColor: colors.surface }}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          automaticallyAdjustKeyboardInsets
          nestedScrollEnabled
          keyboardDismissMode={
            Platform.OS === "ios" ? "interactive" : "on-drag"
          }
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: 18,
            paddingTop: Platform.OS === "ios" ? 20 : 12,
            paddingBottom: 16 + (nativeFooter ? footerHeight : 0),
            gap: 16,
          }}
        >
          <View style={styles.spread}>
            <Text
              accessibilityRole="header"
              style={[styles.heading, { flex: 1 }]}
            >
              {title}
            </Text>
            <IconButton icon={X} label="关闭面板" onPress={closeSheet} />
          </View>
          {children}
        </ScrollView>
        {!nativeFooter && footerView}
      </View>
    </>
  );
}

export function UnavailableSheet() {
  return (
    <Sheet title="操作已结束">
      <Label muted>房间或成员状态已改变，请关闭面板后重试。</Label>
    </Sheet>
  );
}
