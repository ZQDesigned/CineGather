import { isIP } from "node:net";
export function sessionDevice(input: {
  platform?: string;
  version?: string;
  agent?: string;
  address?: string;
}) {
  const platform = [
    "win32",
    "darwin",
    "linux",
    "web",
    "android",
    "ios",
  ].includes(input.platform ?? "")
    ? input.platform!
    : "unknown";
  const agent = (input.agent ?? "").slice(0, 1024);
  const os =
    platform === "android"
      ? "Android"
      : platform === "ios"
        ? "iOS"
        : platform === "win32" || /Windows NT/.test(agent)
          ? "Windows"
          : /iPhone|iPad/.test(agent)
            ? "iOS"
            : /Android/.test(agent)
              ? "Android"
              : platform === "darwin" || /Macintosh|Mac OS X/.test(agent)
                ? "macOS"
                : platform === "linux" || /Linux/.test(agent)
                  ? "Linux"
                  : undefined;
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : undefined;
  const native = ["win32", "darwin", "linux", "android", "ios"].includes(
    platform,
  );
  return {
    deviceName:
      native && os
        ? `${os} 客户端`
        : browser
          ? `${browser}${os ? `（${os}）` : ""}`
          : "未知设备",
    clientPlatform: platform,
    clientVersion:
      input.version &&
      input.version.length <= 40 &&
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(input.version)
        ? input.version
        : null,
    loginAddress:
      input.address && input.address.length <= 64 && isIP(input.address)
        ? input.address
        : null,
  };
}
