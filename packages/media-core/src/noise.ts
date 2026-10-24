import type { NoiseReduction } from "@cinegather/contracts";

export interface MicrophoneNoiseStatus {
  requested: NoiseReduction;
  active: NoiseReduction;
  reason?: string;
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
) {
  try {
    const { MicrophoneDenoiser } = await import("./noise-processor");
    return new MicrophoneDenoiser(status);
  } catch (error) {
    status({
      requested: "enhanced",
      active: "basic",
      reason:
        error instanceof Error ? error.message : "Noise processor unavailable",
    });
    return undefined;
  }
}
