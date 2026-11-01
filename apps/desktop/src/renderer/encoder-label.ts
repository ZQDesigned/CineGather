import type { NativeEncoderInventory } from "@cinegather/contracts";

export function automaticEncoderLabel(
  inventory: NativeEncoderInventory | undefined,
  sharing: boolean,
  error = false,
) {
  if (error) return "自动选择（暂无法检测）";
  if (!inventory) return "自动选择（检测中）";
  const id = sharing ? inventory.activeEncoder : inventory.automaticEncoder;
  const encoder = inventory.encoders.find((e) => e.id === id && e.available);
  if (!encoder) {
    if (sharing) return "自动选择（等待编码器启动）";
    return inventory.encoders.some((e) => e.available)
      ? "自动选择（共享时确定）"
      : "自动选择（无可用编码器）";
  }
  const index = encoder.adapterIndex;
  const type = inventory.adapters.find((a) => a.index === index)?.gpuType;
  let gpu = "";
  if (encoder.hardware && type === "integrated") gpu = "，核显";
  if (encoder.hardware && type === "discrete") gpu = "，独显";
  return `自动选择（${sharing ? "当前" : "优先"}：${encoder.name}${gpu}）`;
}
