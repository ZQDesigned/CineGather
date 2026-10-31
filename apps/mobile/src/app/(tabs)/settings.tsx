import { useState, useEffect } from "react";
import { Text, View, Linking, Alert, AppState } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import {
  Bell,
  Smartphone,
  KeyRound,
  LogOut,
  Download,
  Wifi,
  Mic,
  Monitor,
} from "lucide-react-native";
import { runtime } from "../../runtime";
import {
  useSession,
  useRuntime,
  useMedia,
  action,
} from "../../components/use-runtime";
import { Screen } from "../../components/Screen";
import {
  styles,
  colors,
  Button,
  Label,
  Avatar,
  Field,
  Dialog,
  MenuRow,
  SectionHeading,
  Badge,
} from "../../components/ui";
import { enableNotifications } from "../../platform/notifications";
import { exportDiagnostics } from "../../platform/diagnostics";
export default function Settings() {
  const session = useSession(),
    state = useRuntime(),
    media = useMedia();
  const [passwordDialog, setPasswordDialog] = useState(false),
    [old, setOld] = useState(""),
    [password, setPassword] = useState("");
  const [notifications, setNotifications] = useState<boolean>();
  useEffect(() => {
    let alive = true;
    const read = () => {
      void Notifications.getPermissionsAsync()
        .then((p) => {
          if (alive) setNotifications(p.granted);
        })
        .catch(() => {});
    };
    read();
    const listener = AppState.addEventListener("change", (s) => {
      if (s === "active") read();
    });
    return () => {
      alive = false;
      listener.remove();
    };
  }, []);
  return (
    <Screen title="设置">
      <View style={[styles.card, styles.row, { paddingVertical: 18 }]}>
        <Avatar name={session.user?.displayName ?? "映"} size={48} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text numberOfLines={1} style={styles.heading}>
            {session.user?.displayName}
          </Text>
          <Label muted>{session.user?.username}</Label>
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <SectionHeading title="通知" />
        <View style={styles.group}>
          <MenuRow
            icon={Bell}
            title="系统通知"
            detail="完全退出应用后暂不接收远程推送"
            last
            value={
              notifications !== undefined && (
                <Badge tone={notifications ? "success" : "muted"}>
                  {notifications ? "已开启" : "未开启"}
                </Badge>
              )
            }
            onPress={action(async () => {
              const granted = await enableNotifications();
              setNotifications(granted);
              if (!granted)
                Alert.alert("通知未开启", "可在系统设置中允许映聚发送通知。", [
                  { text: "取消" },
                  {
                    text: "打开系统设置",
                    onPress: () => {
                      void Linking.openSettings();
                    },
                  },
                ]);
              else runtime.notice("通知已开启", "房间与好友通知将在后台提醒你");
            })}
          />
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <SectionHeading title="账号与安全" />
        <View style={styles.group}>
          <MenuRow
            icon={Smartphone}
            title="登录设备"
            onPress={() => router.push("/devices")}
          />
          <MenuRow
            icon={KeyRound}
            title="修改密码"
            last
            onPress={() => {
              setOld("");
              setPassword("");
              setPasswordDialog(true);
            }}
          />
        </View>
      </View>
      <View style={{ gap: 8 }}>
        <SectionHeading title="连接诊断" />
        <View style={styles.group}>
          <View
            style={{
              flexDirection: "row",
              paddingVertical: 16,
              borderBottomWidth: 0.5,
              borderBottomColor: colors.border,
            }}
          >
            {[
              {
                icon: Wifi,
                label: "房间连接",
                value:
                  state.roomState === "connected"
                    ? "正常"
                    : state.roomState === "idle"
                      ? "未加入"
                      : "连接中",
                active: state.roomState === "connected",
              },
              {
                icon: Mic,
                label: "麦克风",
                value: media.microphone ? "已开启" : "已关闭",
                active: media.microphone,
              },
              {
                icon: Monitor,
                label: "共享画面",
                value: media.watching
                  ? media.foreground
                    ? "观看中"
                    : "仅声音"
                  : "未观看",
                active: media.watching,
              },
            ].map(({ icon: Icon, label, value, active }) => (
              <View
                key={label}
                style={{ flex: 1, alignItems: "center", gap: 5 }}
              >
                <Icon size={19} color={active ? colors.green : colors.muted} />
                <Label muted>{label}</Label>
                <Text
                  style={{
                    color: active ? colors.green : colors.text,
                    fontSize: 12,
                  }}
                >
                  {value}
                </Text>
              </View>
            ))}
          </View>
          <MenuRow
            icon={Download}
            title="导出诊断"
            last
            onPress={action(exportDiagnostics)}
          />
        </View>
      </View>
      <View style={styles.group}>
        <MenuRow
          icon={LogOut}
          title="退出登录"
          danger
          last
          onPress={() =>
            Alert.alert("退出登录", "将同时退出当前房间。", [
              { text: "取消" },
              {
                text: "退出",
                style: "destructive",
                onPress: action(() => runtime.signOut()),
              },
            ])
          }
        />
      </View>
      <Text
        style={[
          styles.muted,
          { textAlign: "center", color: colors.muted, paddingVertical: 4 },
        ]}
      >
        映聚手机版 v{runtime.version}
      </Text>
      <Dialog
        visible={passwordDialog}
        title="修改密码"
        close={() => setPasswordDialog(false)}
      >
        <Field
          label="当前密码"
          value={old}
          onChangeText={setOld}
          secureTextEntry
        />
        <Field
          label="新密码（至少 10 位）"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />
        <Button
          primary
          onPress={action(async () => {
            await runtime.api.call("change-password", (c) =>
              c.POST("/api/v1/accounts/password", {
                body: { currentPassword: old, password },
              }),
            );
            setPasswordDialog(false);
            setOld("");
            setPassword("");
            runtime.notice("密码已修改", "请使用新密码登录其他设备");
          })}
        >
          保存密码
        </Button>
      </Dialog>
    </Screen>
  );
}
