import type { DesktopSettings } from "@cinegather/contracts";
type AudioKind = "audioinput" | "audiooutput";
type Selection = Pick<DesktopSettings, "inputDevice" | "outputDevice">;
const explicit = (id: string) =>
  id && id !== "default" && id !== "communications";
export function reconcileAudioDevices(
  selected: Selection,
  devices: readonly MediaDeviceInfo[],
  permissionGranted = false,
) {
  const result = { ...selected, missing: [] as AudioKind[] };
  for (const [kind, key] of [
    ["audioinput", "inputDevice"],
    ["audiooutput", "outputDevice"],
  ] as const) {
    const available = devices.filter((d) => d.kind === kind);
    // Before permission Chromium can redact both IDs and labels. Absence in that
    // list does not prove that a previously selected device was disconnected.
    const reliable =
      permissionGranted || available.some((d) => d.label && d.deviceId);
    if (
      explicit(selected[key]) &&
      reliable &&
      !available.some((d) => d.deviceId === selected[key])
    ) {
      result[key] = "";
      result.missing.push(kind);
    }
  }
  return result;
}
export function audioDeviceOptions(
  kind: AudioKind,
  devices: readonly MediaDeviceInfo[],
  selected: string,
) {
  const noun = kind === "audioinput" ? "麦克风" : "扬声器 / 耳机";
  const options = [
    {
      value: "",
      label: kind === "audioinput" ? "系统默认麦克风" : "系统默认输出",
    },
    ...devices
      .filter((d) => d.kind === kind && explicit(d.deviceId))
      .map((d, i) => ({
        value: d.deviceId,
        label: d.label || `${noun} ${i + 1}`,
      })),
  ];
  if (selected && !options.some((d) => d.value === selected))
    options.push({
      value: selected,
      label: `已保存的${kind === "audioinput" ? "麦克风" : "输出设备"}（等待设备授权）`,
    });
  return options;
}
