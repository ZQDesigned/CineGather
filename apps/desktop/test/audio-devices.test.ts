import { expect, test } from "bun:test";
import {
  reconcileAudioDevices,
  audioDeviceOptions,
} from "../src/renderer/audio-devices";
const d = (kind: MediaDeviceKind, deviceId: string, label = "") =>
  ({ kind, deviceId, label }) as MediaDeviceInfo;
test("missing saved devices fall back independently without changing valid devices", () => {
  const result = reconcileAudioDevices(
    { inputDevice: "gone", outputDevice: "headset" },
    [
      d("audioinput", "default", "内建麦克风"),
      d("audiooutput", "headset", "耳机"),
    ],
  );
  expect(result).toEqual({
    inputDevice: "",
    outputDevice: "headset",
    missing: ["audioinput"],
  });
  expect(
    reconcileAudioDevices(
      { inputDevice: "mic", outputDevice: "gone" },
      [d("audioinput", "mic", "USB 麦克风")],
      true,
    ).missing,
  ).toEqual(["audiooutput"]);
});
test("a privacy-redacted list is not evidence that saved devices were unplugged", () => {
  expect(
    reconcileAudioDevices({ inputDevice: "mic", outputDevice: "headset" }, [
      d("audioinput", ""),
    ]).missing,
  ).toEqual([]);
  expect(
    reconcileAudioDevices(
      { inputDevice: "mic", outputDevice: "headset" },
      [],
      true,
    ),
  ).toEqual({
    inputDevice: "",
    outputDevice: "",
    missing: ["audioinput", "audiooutput"],
  });
});
test("select options never display an opaque ID for saved or unnamed devices", () => {
  const options = audioDeviceOptions(
    "audioinput",
    [d("audioinput", "random-id")],
    "saved-secret-id",
  );
  expect(options.find((o) => o.value === "saved-secret-id")?.label).toBe(
    "已保存的麦克风（等待设备授权）",
  );
  expect(options.find((o) => o.value === "random-id")?.label).toBe("麦克风 1");
  expect(options[0]?.value).toBe("");
});
