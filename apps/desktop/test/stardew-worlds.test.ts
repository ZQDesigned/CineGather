import { expect, test } from "bun:test";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { win32 } from "node:path";
import {
  probeStardewWorld,
  windowsUdpPortPresent,
} from "../src/main/games/stardew-worlds";

test("Windows reads exclusive UDP listeners without attempting to rebind the game's socket", async () => {
  const table =
    "活动连接\r\n  协议  本地地址  外部地址  PID\r\n  UDP    0.0.0.0:24642    *:*    18360\r\n";
  const world = await probeStardewWorld(24642, {
    platform: "win32",
    readWindowsUdpTable: async () => table,
  });
  expect(world.game).toBe("stardew-valley");
  expect(world.port).toBe(24642);
});

test("port table matching is exact, local and UDP-only instead of treating every access denial as a game", () => {
  expect(windowsUdpPortPresent(" UDP 127.0.0.1:24642 *:* 42", 24642)).toBe(
    true,
  );
  for (const row of [
    " UDP 0.0.0.0:246420 *:* 42",
    " UDP 192.168.1.2:24642 *:* 42",
    " TCP 127.0.0.1:24642 0.0.0.0:0 LISTENING 42",
    " UDP 127.0.0.1:2464 *:* 42",
    " UDP 127.0.0.1:9 127.0.0.1:24642 42",
  ])
    expect(windowsUdpPortPresent(row, 24642)).toBe(false);
});

test("Windows distinguishes a missing listener from a failed port-table query and preserves the underlying code", async () => {
  await expect(
    probeStardewWorld(24642, {
      platform: "win32",
      readWindowsUdpTable: async () => "活动连接\r\n",
    }),
  ).rejects.toThrow("开启合作农场");
  try {
    await probeStardewWorld(24642, {
      platform: "win32",
      readWindowsUdpTable: async () => {
        throw Object.assign(Error("denied"), { code: "EACCES" });
      },
    });
    throw Error("must reject");
  } catch (error) {
    expect((error as NodeJS.ErrnoException).code).toBe("EACCES");
    expect((error as Error).message).toContain("端口状态");
  }
});

test.skipIf(process.platform !== "win32")(
  "real Windows exclusive .NET UDP ownership is detected without a second bind",
  async () => {
    const powershell = win32.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const code =
      "$ErrorActionPreference='Stop';$s=[System.Net.Sockets.Socket]::new([System.Net.Sockets.AddressFamily]::InterNetwork,[System.Net.Sockets.SocketType]::Dgram,[System.Net.Sockets.ProtocolType]::Udp);$s.ExclusiveAddressUse=$true;$s.Bind([System.Net.IPEndPoint]::new([System.Net.IPAddress]::Any,0));[Console]::Out.WriteLine($s.LocalEndPoint.Port);[Console]::Out.Flush();[void][Console]::ReadLine();$s.Dispose()";
    const child = spawn(
      powershell,
      ["-NoProfile", "-NonInteractive", "-Command", code],
      { windowsHide: true, stdio: "pipe" },
    );
    try {
      const port = await new Promise<number>((resolve, reject) => {
        let out = "";
        const timer = setTimeout(
          () => reject(Error("exclusive UDP fixture timeout")),
          8000,
        );
        child.stdout.on("data", (data) => {
          out += data;
          const match = /^\s*(\d+)\s*\r?\n/.exec(out);
          if (match) {
            clearTimeout(timer);
            resolve(Number(match[1]));
          }
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(Error("exclusive UDP fixture exited"));
        });
      });
      expect((await probeStardewWorld(port)).port).toBe(port);
      const socket = createSocket("udp4");
      const denied = await new Promise<string>((resolve) => {
        socket.once("error", (error) =>
          resolve((error as NodeJS.ErrnoException).code ?? "unknown"),
        );
        socket.bind(port, "127.0.0.1", () => resolve("unexpected-success"));
      }).finally(() => {
        try {
          socket.close();
        } catch {
          /* failed bind */
        }
      });
      expect(["EACCES", "EADDRINUSE"]).toContain(denied);
    } finally {
      child.stdin.end("\n");
      child.kill();
    }
  },
  15000,
);
test("Stardew probing reports a local occupied UDP service without fabricating a Minecraft protocol or game version", async () => {
  const socket = createSocket("udp4");
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  try {
    const world = await probeStardewWorld(port);
    expect(world).toEqual({
      game: "stardew-valley",
      port,
      name: "本机农场",
      version: "",
      transport: "tcp-udp",
    });
  } finally {
    socket.close();
  }
  await new Promise((r) => setTimeout(r, 10));
  await expect(probeStardewWorld(port)).rejects.toThrow("联机");
});
