import { RefreshCw, Smartphone } from "lucide-react-native";
import { Screen } from "../components/Screen";
import { useEffect, useState } from "react";
import { Text, View, Alert } from "react-native";
import type { operations } from "@cinegather/api-client";
import { runtime } from "../runtime";
import { styles, Label, Button, Badge, IconButton } from "../components/ui";
import { action } from "../components/use-runtime";
type Sessions =
  operations["listDeviceSessions"]["responses"][200]["content"]["application/json"];
export default function Devices() {
  const [sessions, setSessions] = useState<Sessions>();
  const load = async () =>
    setSessions(
      await runtime.api.call("sessions", (c) =>
        c.GET("/api/v1/accounts/sessions"),
      ),
    );
  useEffect(() => {
    void load().catch((e) => runtime.fail(e));
  }, []);
  return (
    <Screen
      title="登录设备"
      back
      actions={
        <IconButton icon={RefreshCw} label="刷新设备" onPress={action(load)} />
      }
    >
      {sessions?.items.map((device) => (
        <View key={device.id} style={styles.card}>
          <View style={styles.row}>
            <Smartphone size={22} color="#969fb4" />
            <Text style={[styles.heading, { flex: 1 }]}>
              {device.deviceName}
            </Text>
            {device.current && <Badge tone="accent">当前设备</Badge>}
          </View>
          <Label muted>
            最近使用{" "}
            {device.lastActiveAt
              ? new Date(device.lastActiveAt).toLocaleString()
              : "暂无记录"}
          </Label>
          {!device.current && (
            <Button
              danger
              onPress={() =>
                Alert.alert(
                  "退出这台设备？",
                  "这台设备的语音和共享将立即断开。",
                  [
                    { text: "取消" },
                    {
                      text: "退出设备",
                      style: "destructive",
                      onPress: action(async () => {
                        await runtime.api.call("revoke-device", (c) =>
                          c.DELETE("/api/v1/accounts/sessions/{sessionId}", {
                            params: { path: { sessionId: device.id } },
                          }),
                        );
                        await load();
                      }),
                    },
                  ],
                )
              }
            >
              退出设备
            </Button>
          )}
        </View>
      ))}
    </Screen>
  );
}
