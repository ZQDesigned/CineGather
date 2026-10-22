export interface AudioSample {
  at: number;
  film: number;
  other: number;
  voice: number;
  own: number;
}
export interface AVMeasurement {
  durationMs: number;
  samples: { at: number; stamp: number; age: number }[];
  audio: AudioSample[];
  videoPulses: { at: number; stamp: number }[];
  audioPulses: { at: number }[];
  calibrationMs: number;
}
declare global {
  interface Window {
    cgAudioContexts?: AudioContext[];
    cgMeasure?: (ms: number) => Promise<AVMeasurement>;
    cgJoin?: (token: string, url: string) => Promise<void>;
    cgReceived?: HTMLVideoElement;
    cgRoom?: import("livekit-client").Room;
  }
}
// Serialized into the owned external Electron fixture by Playwright.
export async function startAVSource() {
  const ac = new AudioContext({ sampleRate: 48000 });
  await ac.resume();
  window.cgAudioContexts = [ac];
  const tone = ac.createOscillator(),
    gain = ac.createGain();
  tone.frequency.value = 523.25;
  gain.gain.value = 0.03;
  tone.connect(gain).connect(ac.destination);
  tone.start();
  const pulse = ac.createOscillator(),
    pg = ac.createGain();
  pulse.frequency.value = 1200;
  pg.gain.value = 0;
  pulse.connect(pg).connect(ac.destination);
  pulse.start();
  const canvas = document.querySelector("canvas")!,
    g = canvas.getContext("2d")!;
  let last = 0;
  const schedule = () => {
    const now = Date.now(),
      next = Math.ceil((now + 500) / 2000) * 2000;
    if (next === last) return;
    last = next;
    const stamp = ac.getOutputTimestamp();
    const target =
      stamp.contextTime! +
      (performance.now() - stamp.performanceTime! + next - now) / 1000;
    pg.gain.setValueAtTime(0, target - 0.001);
    pg.gain.setValueAtTime(0.08, target);
    pg.gain.setValueAtTime(0.08, target + 0.12);
    pg.gain.setValueAtTime(0, target + 0.121);
  };
  setInterval(schedule, 200);
  schedule();
  const frame = () => {
    const t = Date.now();
    g.fillStyle = "#172f48";
    g.fillRect(0, 0, 1280, 720);
    g.fillStyle = "#ff00ff";
    g.fillRect(0, 0, 1280, 14);
    const bits = BigInt(t).toString(2).padStart(48, "0");
    for (let i = 0; i < 48; i++) {
      g.fillStyle = bits[i] === "1" ? "#fff" : "#000";
      g.fillRect(64 + i * 24, 25, 24, 45);
    }
    g.fillStyle = t % 2000 < 120 ? "#fff" : "#000";
    g.fillRect(0, 130, 1280, 100);
    g.fillStyle = "#f3b64d";
    g.fillRect((t / 8) % 1100, 300, 160, 250);
    g.fillStyle = "white";
    g.font = "32px monospace";
    g.fillText("CG SYSTEM AUDIO · " + t, 40, 650);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    state: ac.state,
    sampleRate: ac.sampleRate,
    outputLatency: ac.outputLatency,
  };
}
export async function startOwnTone(frequency: number) {
  const ac = new AudioContext({ sampleRate: 48000 });
  await ac.resume();
  const osc = ac.createOscillator(),
    gain = ac.createGain();
  osc.frequency.value = frequency;
  gain.gain.value = 0.04;
  osc.connect(gain).connect(ac.destination);
  osc.start();
  (window.cgAudioContexts ??= []).push(ac);
  return ac.state;
}
