import {
  defaultMicrophoneReverbStrength,
  type MicrophoneEffect,
  type NoiseReduction,
} from "@cinegather/contracts";
import { createMicrophoneDenoiser, type MicrophoneNoiseStatus } from "./noise";
import { MicrophoneInput } from "./microphone-input";
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
  volume = 100,
) {
  const denoiser =
    mode === "enhanced" ? await createMicrophoneDenoiser(status) : undefined;
  return new MicrophoneInput(
    effect === "ktv" ? new KtvReverb(denoiser, isMuted, strength) : denoiser,
    isMuted,
    volume,
  );
}
