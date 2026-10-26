import { Resvg } from "@resvg/resvg-js";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const resources = join(root, "apps/desktop/resources");
const source = await readFile(join(resources, "icon.svg"), "utf8");
const render = (size: number) =>
  new Resvg(source, { fitTo: { mode: "width", value: size } }).render().asPng();
// One rounded, transparent-corner source for browser and native app icons.
await writeFile(join(resources, "icon.png"), render(1024));
await writeFile(join(resources, "apple-touch-icon.png"), render(180));
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(render);
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
for (let i = 0; i < sizes.length; i++) {
  const at = 6 + i * 16,
    size = sizes[i]!,
    png = images[i]!;
  header[at] = header[at + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(png.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += png.length;
}
await writeFile(
  join(resources, "icon.ico"),
  Buffer.concat([header, ...images]),
);
if (process.platform === "darwin") {
  const iconset = join(root, ".local/app-icon.iconset");
  await mkdir(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    await writeFile(join(iconset, `icon_${size}x${size}.png`), render(size));
    await writeFile(
      join(iconset, `icon_${size}x${size}@2x.png`),
      render(size * 2),
    );
  }
  const result = Bun.spawnSync([
    "iconutil",
    "-c",
    "icns",
    iconset,
    "-o",
    join(resources, "icon.icns"),
  ]);
  if (result.exitCode !== 0) throw new Error("macOS icon generation failed");
  await rm(iconset, { recursive: true });
}
console.log("Rounded SVG, PNG, Windows ICO and macOS ICNS icons generated.");
