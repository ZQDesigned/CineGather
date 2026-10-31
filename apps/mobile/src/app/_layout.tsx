import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { View, Text, Pressable } from "react-native";
import { runtime } from "../runtime";
import { useSession, useRuntime } from "../components/use-runtime";
import { Auth } from "../components/Auth";
import { colors, Dialog, Label, Button } from "../components/ui";
import { nativeSheetOptions } from "../components/Sheet";
export default function Layout() {
  const session = useSession(),
    state = useRuntime();
  useEffect(() => {
    runtime.start();
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {session.status !== "signed-in" ? (
        <Auth />
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <Stack
            screenOptions={{
              headerShown: false,
              headerStyle: { backgroundColor: colors.bg },
              headerTintColor: colors.text,
              contentStyle: { backgroundColor: colors.bg },
              headerShadowVisible: false,
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="room"
              options={{
                title: state.room?.name ?? "房间",
                headerBackTitle: "返回",
              }}
            />
            <Stack.Screen name="audio-options" options={nativeSheetOptions} />
            <Stack.Screen name="member-options" options={nativeSheetOptions} />
            <Stack.Screen name="invite-friends" options={nativeSheetOptions} />
            <Stack.Screen name="devices" options={{ title: "登录设备" }} />
          </Stack>
          <ErrorToast />
          <Dialog
            visible={!!state.popup}
            title={state.popup?.title ?? "全站公告"}
            close={() => {
              if (state.popup)
                void runtime
                  .readAnnouncement(state.popup.id)
                  .catch((e) => runtime.fail(e));
            }}
          >
            <Label>{state.popup?.body}</Label>
            <Button
              primary
              onPress={async () => {
                if (state.popup) await runtime.readAnnouncement(state.popup.id);
              }}
            >
              知道了
            </Button>
          </Dialog>
        </View>
      )}
    </SafeAreaProvider>
  );
}

function ErrorToast() {
  const state = useRuntime(),
    insets = useSafeAreaInsets();
  if (!state.error) return null;
  const banner = state.announcements.some(
    (a) => a.kind === "maintenance" && a.state === "active",
  );
  return (
    <Pressable
      accessibilityRole="alert"
      onPress={() => runtime.clearError()}
      style={{
        position: "absolute",
        top: insets.top + 52 + (banner ? 44 : 0) + 8,
        left: 16,
        right: 16,
        padding: 14,
        borderRadius: 14,
        backgroundColor: "#492735",
      }}
    >
      <Text style={{ color: colors.text, fontSize: 14, lineHeight: 22 }}>
        {state.error}
      </Text>
    </Pressable>
  );
}
