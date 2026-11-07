import { createSocket } from "node:dgram";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { win32 } from "node:path";
import { gamePortSchema, type GameWorld } from "@cinegather/contracts";

const execute = promisify(execFile);
function probeError(message: string, code: string) {
  return Object.assign(Error(message), { code });
}

/** Read only numeric IPv4 UDP endpoints, independent of localized headings.
 * A listener on another interface is not reachable via our 127.0.0.1 target.
 */
export function windowsUdpPortPresent(table: string, port: number) {
  gamePortSchema.parse(port);
  if (table.length > 2 * 1024 * 1024)
    throw probeError("本机端口状态返回异常，请稍后重试", "PROTOCOL_OVERSIZED");
  const endpoints = new Set([`0.0.0.0:${port}`, `127.0.0.1:${port}`]);
  return table.split(/\r?\n/).some((line) => {
    const columns = line.trim().split(/\s+/);
    return (
      columns[0]?.toUpperCase() === "UDP" && endpoints.has(columns[1] ?? "")
    );
  });
}
async function readWindowsUdpTable() {
  // No -b: executable inspection can require additional permissions. No shell,
  // no PATH search, no port changes and no elevation request.
  const binary = win32.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "netstat.exe",
  );
  const { stdout } = await execute(binary, ["-a", "-n", "-o", "-p", "udp"], {
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 2 * 1024 * 1024,
    encoding: "utf8",
  });
  return stdout;
}
interface ProbeOptions {
  platform?: NodeJS.Platform;
  readWindowsUdpTable?: () => Promise<string>;
}

/** A local-port observation, not proof of a game handshake or a player in a farm.
 * No untrusted network probe, save inspection, or invented game version.
 */
export async function probeStardewWorld(
  port: number,
  options: ProbeOptions = {},
): Promise<GameWorld> {
  gamePortSchema.parse(port);
  let occupied: boolean;
  if ((options.platform ?? process.platform) === "win32") {
    try {
      occupied = windowsUdpPortPresent(
        await (options.readWindowsUdpTable ?? readWindowsUdpTable)(),
        port,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw probeError(
        "无法读取本机游戏端口状态，请稍后重试",
        typeof code === "string" && /^[A-Z_0-9]{1,64}$/.test(code)
          ? code
          : "PORT_TABLE_FAILED",
      );
    }
  } else {
    const socket = createSocket("udp4");
    occupied = await new Promise<boolean>((resolve, reject) => {
      socket.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") resolve(true);
        else
          reject(
            probeError(
              "无法检查本机游戏端口",
              error.code ?? "PORT_PROBE_FAILED",
            ),
          );
      });
      socket.bind(port, "127.0.0.1", () => resolve(false));
    }).finally(() => {
      try {
        socket.close();
      } catch {
        /* bind failed */
      }
    });
  }
  if (!occupied)
    throw probeError(
      "未检测到本机联机服务，请在星露谷中开启合作农场后重试",
      "PORT_NOT_LISTENING",
    );
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
