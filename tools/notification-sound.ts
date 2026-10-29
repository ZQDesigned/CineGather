import { writeFile } from "node:fs/promises";
// Original damped two-tone cue with soft attack and release; no external recording.
const rate = 24000,
  length = Math.round(rate * 0.42),
  wav = Buffer.alloc(44 + length * 2);
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
  const t = i / rate,
    envelope =
      Math.sin((Math.min(1, t / 0.035) * Math.PI) / 2) ** 2 *
      Math.exp(-10 * t) *
      Math.min(1, (0.42 - t) / 0.08);
  const signal =
    0.11 *
    envelope *
    (Math.sin(2 * Math.PI * 587.33 * t) +
      0.3 * Math.sin(2 * Math.PI * 880 * t));
  wav.writeInt16LE(Math.round(signal * 32767), 44 + i * 2);
}
await writeFile(
  new URL(
    "../apps/desktop/src/renderer/assets/notification.wav",
    import.meta.url,
  ),
  wav,
);
