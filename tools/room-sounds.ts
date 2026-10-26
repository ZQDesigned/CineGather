import { mkdir, writeFile } from "node:fs/promises";
const directory = new URL(
  "../apps/desktop/src/renderer/assets/",
  import.meta.url,
);
await mkdir(directory, { recursive: true });
// Original, deterministic felt-pluck cues; no external recordings or licensing.
const rate = 24000,
  length = Math.round(rate * 0.68);
for (const kind of ["enter", "leave"] as const) {
  const notes = kind === "enter" ? [392, 523.251] : [523.251, 392];
  const wav = Buffer.alloc(44 + length * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) {
    let sample = 0;
    for (let note = 0; note < 2; note++) {
      const t = i / rate - note * 0.16;
      if (t < 0 || t >= 0.5) continue;
      const envelope =
        Math.sin((Math.min(1, t / 0.025) * Math.PI) / 2) ** 2 *
        Math.exp(-8 * t) *
        Math.min(1, (0.5 - t) / 0.08);
      const phase = 2 * Math.PI * notes[note]! * t;
      sample +=
        0.075 *
        envelope *
        (Math.sin(phase) +
          0.12 * Math.exp(-8 * t) * Math.sin(phase * 2.003) +
          0.035 * Math.exp(-14 * t) * Math.sin(phase * 3.01));
    }
    wav.writeInt16LE(Math.round(sample * 32767), 44 + i * 2);
  }
  await writeFile(new URL(`room-${kind}.wav`, directory), wav);
}
console.log("Generated original soft room entry/exit cues.");
