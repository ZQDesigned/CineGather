import { type ReactNode } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { router } from "expo-router";
import { ArrowLeft, LogOut, Radio } from "lucide-react-native";
import { Page, IconButton, colors } from "./ui";
import { DndButton } from "./DndButton";
import { MaintenanceBanner } from "./MaintenanceBanner";
import { useRuntime, action } from "./use-runtime";
import { runtime } from "../runtime";
export function Screen({
  title,
  children,
  actions,
  back,
  scroll = true,
  safeBottom = Platform.OS === "ios",
  currentRoom = true,
  contentStyle,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  back?: boolean;
  scroll?: boolean;
  safeBottom?: boolean;
  currentRoom?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const state = useRuntime();
  return (
    <Page
      safeTop
      safeBottom={safeBottom}
      scroll={scroll}
      contentStyle={contentStyle}
      header={
        <View testID="screen-chrome">
          <View
            testID="screen-header"
            style={{
              height: 52,
              paddingHorizontal: 16,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
            }}
          >
            {back && (
              <View style={{ marginLeft: -10 }}>
                <IconButton
                  icon={ArrowLeft}
                  label="返回"
                  onPress={() =>
                    router.canGoBack() ? router.back() : router.replace("/")
                  }
                />
              </View>
            )}
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                color: colors.text,
                fontSize: 22,
                lineHeight: 30,
                fontWeight: "700",
              }}
            >
              {title}
            </Text>
            {actions}
            <DndButton />
          </View>
          <MaintenanceBanner />
          {currentRoom && state.room && (
            <View
              testID="current-room-strip"
              style={{
                marginHorizontal: 16,
                marginTop: 4,
                marginBottom: 4,
                paddingLeft: 12,
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: colors.surface,
                borderRadius: 12,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.border,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`返回房间 ${state.room.name}`}
                onPress={() => router.push("/room")}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  minHeight: 44,
                }}
              >
                <Radio size={17} color={colors.green} />
                <Text
                  numberOfLines={1}
                  style={{ flex: 1, color: colors.accent, fontSize: 13 }}
                >
                  {state.room.name}
                </Text>
              </Pressable>
              <IconButton
                icon={LogOut}
                label="退出房间"
                danger
                onPress={action(() => runtime.coordinator.leave())}
              />
            </View>
          )}
        </View>
      }
    >
      {children}
    </Page>
  );
}
