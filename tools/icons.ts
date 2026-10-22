import { Resvg } from "@resvg/resvg-js";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const resources = join(root, "apps/desktop/resources");
const source = await readFile(join(resources, "icon.svg"), "utf8");
const render = (size: number) =>
  new Resvg(source, { fitTo: { mode: "width", value: size } }).render().asPng();
// Opaque full-bleed artwork lets macOS apply its own rounded icon mask.
await writeFile(join(resources, "icon.png"), render(1024));
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
console.log("Application icons generated from full-bleed SVG artwork.");
