import {
  defaultMicrophoneReverbStrength,
  type MicrophoneEffect,
  type NoiseReduction,
} from "@cinegather/contracts";
import { createMicrophoneDenoiser, type MicrophoneNoiseStatus } from "./noise";
import { KtvReverb } from "./ktv-reverb";
export type MicrophoneEffectStatus = {
  requested: MicrophoneEffect;
  active: MicrophoneEffect;
  strength?: number;
  reason?: "reverb-unavailable";
};
export async function createMicrophoneProcessor(
  mode: NoiseReduction,
  effect: MicrophoneEffect,
  status: (s: MicrophoneNoiseStatus) => void = () => {},
  isMuted = () => false,
  strength = defaultMicrophoneReverbStrength,
) {
  const denoiser =
    mode === "enhanced" ? await createMicrophoneDenoiser(status) : undefined;
  return effect === "ktv"
    ? new KtvReverb(denoiser, isMuted, strength)
    : denoiser;
}
