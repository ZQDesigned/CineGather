import type { NoiseReduction } from "@cinegather/contracts";

export interface MicrophoneNoiseStatus {
  requested: NoiseReduction;
  active: NoiseReduction;
  reason?: string;
  engine?: "deepfilternet3" | "rnnoise" | "platform";
}
export function microphoneConstraints(mode: NoiseReduction) {
  return {
    echoCancellation: true,
    // Keep the existing platform suppression underneath RNNoise; the neural
    // filter is less effective for some broadband noise on its own.
    noiseSuppression: mode !== "off",
    autoGainControl: true,
    channelCount: 1,
  };
}

export async function createMicrophoneDenoiser(
  status: (status: MicrophoneNoiseStatus) => void,
  mode: "basic" | "enhanced" = "enhanced",
) {
  try {
    const { MicrophoneDenoiser } = await import("./noise-processor");
    return new MicrophoneDenoiser(status, mode);
  } catch (error) {
    status({
      requested: mode,
      engine: "platform",
      active: "basic",
      reason:
        error instanceof Error ? error.message : "Noise processor unavailable",
    });
    return undefined;
  }
}

export function microphoneNoiseWarning(status?: MicrophoneNoiseStatus) {
  return status?.requested !== "off" &&
    status?.engine === "platform" &&
    status.reason
    ? "应用降噪暂不可用，正在使用系统兼容降噪。可稍后重新选择降噪档位重试。"
    : undefined;
}
