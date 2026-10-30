import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
export async function enableNotifications() {
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("room-events", {
      name: "房间与好友通知",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
    });
  return (await Notifications.requestPermissionsAsync()).granted;
}
export async function localNotice(title: string, body: string) {
  if (AppState.currentState === "active") return;
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  await Notifications.scheduleNotificationAsync({
    content: { title, body, sound: false },
    trigger: null,
  });
}
