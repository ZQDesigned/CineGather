import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react-native";
import type { SnackbarItem } from "@cinegather/client-core";
import { runtime } from "../runtime";
import { colors } from "./theme";

const queue = () => runtime.feedback;
const subscribe = (listener: () => void) => queue().subscribe(listener);
const snapshot = () => queue().snapshot();

// Native sheets and RN Modal each need a host inside their own native surface.
// Ownership is exclusive; the root stays available for auth and update gates.
export function SnackbarHost({
  priority = 0,
  enabled = true,
  inline = false,
  bottom = 12,
}: {
  priority?: number;
  enabled?: boolean;
  inline?: boolean;
  bottom?: number;
}) {
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  const [host, setHost] = useState<number>();
  const [keyboardTop, setKeyboardTop] = useState(Keyboard.metrics()?.screenY);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  useLayoutEffect(() => {
    if (!enabled) return;
    const lease = queue().host(priority);
    setHost(lease.id);
    return lease.release;
  }, [enabled, priority]);
  useEffect(() => {
    if (inline || !enabled) return;
    const show = Keyboard.addListener("keyboardDidShow", (event) =>
      setKeyboardTop(event.endCoordinates.screenY),
    );
    const hide = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardTop(undefined),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, [inline, enabled]);
  if (!enabled || host !== state.host || !state.item) return null;
  const keyboard =
    keyboardTop === undefined ? undefined : Math.max(0, height - keyboardTop);
  return (
    <View
      pointerEvents="box-none"
      style={
        inline
          ? { marginHorizontal: 16, marginVertical: 8 }
          : {
              position: "absolute",
              left: 16,
              right: 16,
              bottom:
                keyboard === undefined ? bottom + insets.bottom : keyboard + 12,
              zIndex: 100,
            }
      }
    >
      <SnackbarCard
        key={state.item.id}
        item={state.item}
        exiting={state.phase === "exiting"}
      />
    </View>
  );
}
function SnackbarCard({
  item,
  exiting,
}: {
  item: SnackbarItem;
  exiting: boolean;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const baseDuration = useRef(item.duration).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduceMotion(value);
      })
      .catch(() => {});
    const change = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduceMotion,
    );
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((enabled) => {
        if (active && enabled)
          queue().extend(item.id, Math.max(10000, baseDuration));
      })
      .catch(() => {});
    if (Platform.OS === "android")
      void AccessibilityInfo.getRecommendedTimeoutMillis(baseDuration)
        .then((duration) => {
          if (active) queue().extend(item.id, duration);
        })
        .catch(() => {});
    return () => {
      active = false;
      change.remove();
    };
    // Lifetime is tied to the message, not to an accessibility timeout extension.
  }, [item.id, baseDuration]);
  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: exiting ? 0 : 1,
      duration: reduceMotion ? 0 : exiting ? 150 : 220,
      easing: exiting ? Easing.in(Easing.cubic) : Easing.out(Easing.cubic),
      useNativeDriver: true,
      isInteraction: false,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, exiting, reduceMotion]);
  const color =
    item.tone === "error"
      ? colors.danger
      : item.tone === "success"
        ? colors.green
        : colors.accent;
  const Icon =
    item.tone === "error"
      ? CircleAlert
      : item.tone === "success"
        ? CircleCheck
        : Info;
  return (
    <Animated.View
      testID="feedback-snackbar"
      accessibilityLiveRegion="polite"
      style={[
        styles.card,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [reduceMotion ? 0 : 18, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Icon color={color} size={21} accessible={false} />
      <Text accessibilityRole="alert" style={styles.text} numberOfLines={4}>
        {item.text}
      </Text>
      <Pressable
        testID="dismiss-snackbar"
        accessibilityRole="button"
        accessibilityLabel="关闭提示"
        onPress={() => queue().dismiss(item.id)}
        hitSlop={4}
        style={({ pressed }) => ({
          width: 40,
          height: 40,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 12,
          backgroundColor: pressed ? colors.border : "transparent",
        })}
      >
        <X color={colors.muted} size={18} />
      </Pressable>
    </Animated.View>
  );
}
const styles = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    minHeight: 56,
    paddingLeft: 16,
    paddingRight: 6,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#272d3bf5",
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#52576b",
    boxShadow: "0px 5px 18px #00000038",
  },
  text: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 21 },
});
