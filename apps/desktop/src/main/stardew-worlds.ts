import { createSocket } from "node:dgram";
import { gamePortSchema, type GameWorld } from "@cinegather/contracts";

/** A local-port observation, not proof of a game handshake or a player in a farm.
 * No untrusted network probe, save inspection, or invented game version.
 */
export async function probeStardewWorld(port: number): Promise<GameWorld> {
  gamePortSchema.parse(port);
  const socket = createSocket("udp4");
  const occupied = await new Promise<boolean>((resolve, reject) => {
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolve(true);
      else reject(Error("无法检查本机游戏端口"));
    });
    socket.bind(port, "127.0.0.1", () => resolve(false));
  }).finally(() => {
    try {
      socket.close();
    } catch {
      /* bind failed */
    }
  });
  if (!occupied)
    throw Error("未检测到本机联机服务，请在星露谷中开启合作农场后重试");
  return {
    game: "stardew-valley",
    port,
    name: "本机农场",
    version: "",
    transport: "tcp-udp",
  };
}
export async function discoverStardewWorlds(): Promise<GameWorld[]> {
  try {
    return [await probeStardewWorld(24642)];
  } catch {
    return [];
  }
}
