import { useState } from "react";
import { Text, View, Linking, Alert } from "react-native";
import { router } from "expo-router";
import { runtime } from "../../runtime";
import {
  useSession,
  useRuntime,
  useMedia,
  action,
} from "../../components/use-runtime";
import {
  Page,
  styles,
  Button,
  Label,
  Avatar,
  Field,
  Dialog,
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
  return (
    <Page>
      <View style={[styles.card, styles.row]}>
        <Avatar name={session.user?.displayName ?? "映"} />
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>{session.user?.displayName}</Text>
          <Label muted>{session.user?.username}</Label>
        </View>
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>通知</Text>

        <Button
          onPress={action(async () => {
            const granted = await enableNotifications();
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
        >
          开启系统通知
        </Button>
        <Label muted>完全退出应用后暂不接收远程推送。</Label>
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>账号与安全</Text>
        <Button onPress={() => router.push("/devices")}>登录设备</Button>
        <Button
          onPress={() => {
            setOld("");
            setPassword("");
            setPasswordDialog(true);
          }}
        >
          修改密码
        </Button>
        <Button
          danger
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
        >
          退出登录
        </Button>
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>连接诊断</Text>
        <Label>
          房间：
          {state.roomState === "connected"
            ? "连接正常"
            : state.roomState === "idle"
              ? "尚未加入"
              : "正在连接"}
        </Label>
        <Label>
          语音：{media.microphone ? "麦克风已开启" : "麦克风已关闭"}
        </Label>
        <Label>
          观看：
          {media.watching
            ? media.foreground
              ? "正在观看"
              : "后台仅保留声音"
            : "未加入观看"}
        </Label>
        <Button onPress={action(exportDiagnostics)}>导出诊断</Button>
      </View>
      <Label muted>
        映聚 v{runtime.version} {runtime.origin}
      </Label>
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
    </Page>
  );
}
