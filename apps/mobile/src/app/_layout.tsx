import { useEffect } from "react";
import { Stack, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View } from "react-native";
import { runtime } from "../runtime";
import { useSession, useRuntime } from "../components/use-runtime";
import { Auth } from "../components/Auth";
import { colors, Dialog, Label, Button } from "../components/ui";
import { UpdateGate } from "../components/Updates";
import { SnackbarHost } from "../components/Snackbar";
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
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <UpdateGate>
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
                <Stack.Screen name="create-room" options={nativeSheetOptions} />
                <Stack.Screen name="join-room" options={nativeSheetOptions} />
                <Stack.Screen name="add-friend" options={nativeSheetOptions} />
                <Stack.Screen
                  name="share-screen"
                  options={nativeSheetOptions}
                />
                <Stack.Screen
                  name="audio-options"
                  options={nativeSheetOptions}
                />
                <Stack.Screen
                  name="member-options"
                  options={nativeSheetOptions}
                />
                <Stack.Screen
                  name="invite-friends"
                  options={nativeSheetOptions}
                />
                <Stack.Screen name="devices" options={{ title: "登录设备" }} />
              </Stack>
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
                    if (state.popup)
                      await runtime.readAnnouncement(state.popup.id);
                  }}
                >
                  知道了
                </Button>
              </Dialog>
            </View>
          )}
        </UpdateGate>
        <RootSnackbar />
      </View>
    </SafeAreaProvider>
  );
}

function RootSnackbar() {
  const segments = useSegments();
  return (
    <SnackbarHost
      bottom={segments[0] === "(tabs)" ? 76 : segments[0] === "room" ? 94 : 12}
    />
  );
}
