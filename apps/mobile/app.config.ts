import type { ExpoConfig } from "expo/config";
import { version } from "./package.json";

const config: ExpoConfig = {
  name: "映聚",
  slug: "cinegather",
  version,
  scheme: "cinegather",
  orientation: "default",
  userInterfaceStyle: "dark",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "city.zqdesigned.cinegather.mobile",
    supportsTablet: false,
    infoPlist: {
      UIBackgroundModes: ["audio"],
      NSMicrophoneUsageDescription:
        "映聚需要麦克风权限，与房间内朋友实时语音。",
    },
  },
  android: {
    package: "city.zqdesigned.cinegather.mobile",
    versionCode: 1,
    permissions: [
      "RECORD_AUDIO",
      "MODIFY_AUDIO_SETTINGS",
      "BLUETOOTH_CONNECT",
      "POST_NOTIFICATIONS",
      "FOREGROUND_SERVICE",
      "FOREGROUND_SERVICE_MICROPHONE",
      "FOREGROUND_SERVICE_MEDIA_PLAYBACK",
    ],
    blockedPermissions: [
      "android.permission.CAMERA",
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.SYSTEM_ALERT_WINDOW",
    ],
    adaptiveIcon: {
      foregroundImage: "./assets/icon.png",
      backgroundColor: "#0e1118",
    },
  },
  plugins: [
    "expo-router",
    "./plugins/with-release-signing.cjs",
    "expo-secure-store",
    "expo-sharing",
    "expo-notifications",
    "expo-screen-orientation",
    ["expo-build-properties", { ios: { enableSceneSupport: true } }],
    [
      "expo-splash-screen",
      {
        backgroundColor: "#0e1118",
        image: "./assets/icon.png",
        imageWidth: 112,
        resizeMode: "contain",
      },
    ],
    [
      "@livekit/react-native-expo-plugin",
      {
        android: {
          audioType: "communication",
          enableScreenShareService: false,
        },
      },
    ],
    [
      "@config-plugins/react-native-webrtc",
      { microphonePermission: "映聚需要麦克风权限，与房间内朋友实时语音。" },
    ],
  ],
  experiments: { typedRoutes: true, autolinkingModuleResolution: true },
  extra: {
    apiOrigin:
      process.env.EXPO_PUBLIC_API_ORIGIN ?? "https://cgplat.zqdesigned.city",
  },
};
export default config;
