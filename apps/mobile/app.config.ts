import type { ExpoConfig } from "expo/config";
import { version } from "./package.json";
import mobileRelease from "./mobile-release.json";
const updateOrigin =
  process.env.CG_MOBILE_UPDATE_ORIGIN ?? "https://cgplat.zqdesigned.city";
const updateChannel = process.env.CG_MOBILE_CHANNEL ?? "stable";
if (!["stable", "preview"].includes(updateChannel))
  throw new Error("Invalid mobile update channel");
const updateUrl = new URL(updateOrigin);
if (
  updateUrl.protocol !== "https:" &&
  !["localhost", "127.0.0.1", "10.0.2.2"].includes(updateUrl.hostname)
)
  throw new Error("Mobile updates require HTTPS");

const config: ExpoConfig = {
  name: "映聚",
  slug: "cinegather",
  version,
  scheme: "cinegather",
  runtimeVersion: { policy: "fingerprint" },
  updates: {
    url: `${updateOrigin}/api/v1/mobile-updates/manifest`,
    checkAutomatically: "ON_ERROR_RECOVERY",
    fallbackToCacheTimeout: 0,
    requestHeaders: { "X-CineGather-Channel": updateChannel },
    codeSigningCertificate: "./resources/update-certificate.pem",
    codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
  },
  orientation: "default",
  userInterfaceStyle: "dark",
  icon: "./assets/icon.png",
  ios: {
    bundleIdentifier: "city.zqdesigned.cinegather.mobile",
    supportsTablet: false,
    buildNumber: "2",
    infoPlist: {
      UIBackgroundModes: ["audio"],
      NSMicrophoneUsageDescription:
        "映聚需要麦克风权限，与房间内朋友实时语音。",
    },
  },
  android: {
    package: "city.zqdesigned.cinegather.mobile",
    versionCode: 2,
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
      foregroundImage: "./assets/icon-adaptive-foreground.png",
      backgroundImage: "./assets/icon-adaptive-background.png",
    },
  },
  plugins: [
    "expo-router",
    "./plugins/with-release-signing.cjs",
    "./plugins/with-mobile-updates.cjs",
    "./plugins/with-screen-share.cjs",
    "expo-secure-store",
    "expo-sharing",
    "expo-notifications",
    "expo-screen-orientation",
    [
      "expo-build-properties",
      {
        ios: { enableSceneSupport: true },
        android: { usesCleartextTraffic: updateUrl.protocol === "http:" },
      },
    ],
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
    mobileUpdate: {
      revision: Number(
        process.env.CG_MOBILE_REVISION ?? mobileRelease.revision,
      ),
      version: process.env.CG_MOBILE_VERSION ?? mobileRelease.version,
      channel: updateChannel,
      origin: updateOrigin,
    },
    apiOrigin:
      process.env.EXPO_PUBLIC_API_ORIGIN ?? "https://cgplat.zqdesigned.city",
  },
};
export default config;
