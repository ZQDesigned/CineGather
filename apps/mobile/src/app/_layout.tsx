import { DndButton } from "../components/DndButton";
import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View, Text, Pressable } from "react-native";
import { runtime } from "../runtime";
import { useSession, useRuntime } from "../components/use-runtime";
import { Auth } from "../components/Auth";
import { colors, Dialog, Label, Button } from "../components/ui";
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
                headerRight: () => <DndButton />,
              }}
            />
            <Stack.Screen name="devices" options={{ title: "登录设备" }} />
          </Stack>
          {state.error && (
            <Pressable
              accessibilityRole="alert"
              onPress={() => runtime.clearError()}
              style={{
                position: "absolute",
                top: 100,
                left: 20,
                right: 20,
                padding: 16,
                borderRadius: 14,
                backgroundColor: "#492735",
              }}
            >
              <Text style={{ color: colors.text }}>{state.error}</Text>
            </Pressable>
          )}
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
