import { useEffect, useState } from "react";
import Slider from "@react-native-community/slider";
import { runtime } from "../runtime";
import { action } from "../components/use-runtime";
import { Sheet, UnavailableSheet, useSheetRoom } from "../components/Sheet";
import { Button, Label } from "../components/ui";

export default function AudioOptions() {
  const room = useSheetRoom();
  const [voice, setVoice] = useState(() => runtime.media.gain("voice"));
  const [shared, setShared] = useState(() => runtime.media.gain("share"));
  const [outputs, setOutputs] = useState<string[]>([]);
  useEffect(() => {
    if (!room) return;
    let active = true;
    void runtime.media
      .outputs()
      .then((values) => {
        if (active) setOutputs(values);
      })
      .catch((error) => {
        if (active) runtime.fail(error);
      });
    return () => {
      active = false;
    };
  }, [room?.id]);
  if (!room) return <UnavailableSheet />;
  return (
    <Sheet title="音频">
      <Label>语音音量 {Math.round(voice * 100)}%</Label>
      <Slider
        accessibilityLabel="语音音量"
        minimumValue={0}
        maximumValue={2}
        value={voice}
        onValueChange={(v) => {
          setVoice(v);
          runtime.media.setGain("voice", v);
        }}
      />
      <Label>共享音量 {Math.round(shared * 100)}%</Label>
      <Slider
        accessibilityLabel="共享音量"
        minimumValue={0}
        maximumValue={2}
        value={shared}
        onValueChange={(v) => {
          setShared(v);
          runtime.media.setGain("share", v);
        }}
      />
      <Label>输出设备</Label>
      {outputs.map((output) => (
        <Button
          key={output}
          onPress={action(() => runtime.media.selectOutput(output))}
        >
          {(
            {
              speaker: "扬声器",
              speakerphone: "扬声器",
              earpiece: "听筒",
              headset: "耳机",
              bluetooth: "蓝牙耳机",
              default: "系统选择 / 蓝牙设备",
              force_speaker: "扬声器",
            } as Record<string, string>
          )[output] ?? output}
        </Button>
      ))}
      <Label muted>已启用基础降噪与回声消除。</Label>
    </Sheet>
  );
}
