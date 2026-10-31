import { useState } from "react";
import { Platform, Switch, View, Text } from "react-native";
import { router } from "expo-router";
import { MonitorUp } from "lucide-react-native";
import { mobileShareCapability } from "@cinegather/client-core";
import {
  qualityPresets,
  qualityLabel,
  type Quality,
} from "@cinegather/contracts";
import { runtime } from "../runtime";
import { useRuntime, action } from "../components/use-runtime";
import { Sheet, UnavailableSheet, useSheetRoom } from "../components/Sheet";
import { Button, Label, styles, colors } from "../components/ui";
export default function ShareScreen() {
  const room = useSheetRoom(),
    state = useRuntime();
  const capability = mobileShareCapability(
    Platform.OS,
    parseInt(String(Platform.Version)),
  );
  const [audio, setAudio] = useState(capability.audio);
  const [quality, setQuality] = useState<Quality>("cinema");
  const [starting, setStarting] = useState(false);
  if (!room) return <UnavailableSheet />;
  const busy = starting || !["idle", "failed"].includes(state.shareState);
  return (
    <Sheet
      title="共享屏幕"
      footer={
        <Button
          primary
          icon={MonitorUp}
          testID="share-screen-start"
          disabled={busy || !runtime.canShare()}
          onPress={action(async () => {
            setStarting(true);
            try {
              // Close our sheet before the OS consent UI; capture continues when the
              // person switches to the app they intend to share.
              if (router.canGoBack()) router.back();
              await runtime.startSharing(audio, quality);
            } finally {
              setStarting(false);
            }
          })}
        >
          {busy ? "正在准备共享…" : "开始共享"}
        </Button>
      }
    >
      {!runtime.canShare() && (
        <Label>当前账号尚未开通屏幕共享，或房主已禁止你共享。</Label>
      )}
      <Label>共享画质</Label>
      {(Object.keys(qualityPresets) as Quality[]).map((value) => (
        <Button
          key={value}
          primary={quality === value}
          onPress={() => setQuality(value)}
        >
          {qualityLabel(value)}
        </Button>
      ))}
      <View style={styles.spread}>
        <Text style={styles.text}>同时共享应用声音</Text>
        <Switch
          accessibilityLabel="同时共享应用声音"
          disabled={!capability.audio || busy}
          value={audio}
          onValueChange={setAudio}
        />
      </View>
      <View
        testID="share-compatibility"
        style={{
          padding: 14,
          borderRadius: 12,
          backgroundColor: capability.excludesSelf ? colors.raised : "#493b28",
          gap: 8,
        }}
      >
        <Label>{capability.excludesSelf ? "声音采集说明" : "兼容性提示"}</Label>
        <Label muted>{capability.notice}</Label>
      </View>
      <Label muted>
        共享可能包含通知和私人信息，请确认系统选择的范围。麦克风由房间内的麦克风按钮单独控制。
      </Label>
    </Sheet>
  );
}
