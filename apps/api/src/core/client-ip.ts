import { BlockList, isIP } from "node:net";
import { readFileSync } from "node:fs";
export function readCdnCidrs(path?: string): string[] {
  if (!path) return [];
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string"))
    throw new Error(
      "TRUSTED_CDN_CIDRS_FILE must contain a JSON array of CIDRs",
    );
  return value;
}
export function cdnClientIp(cidrs: readonly string[]) {
  const ranges = new BlockList();
  for (const cidr of cidrs) {
    const [ip, prefix, extra] = cidr.split("/");
    const family = isIP(ip!);
    const bits = Number(prefix);
    if (
      !family ||
      prefix === undefined ||
      extra !== undefined ||
      !/^\d+$/.test(prefix) ||
      bits > (family === 4 ? 32 : 128)
    )
      throw new Error("Invalid trusted CDN CIDR: " + cidr);
    ranges.addSubnet(ip!, bits, family === 4 ? "ipv4" : "ipv6");
  }
  return (
    proxyTrusted: boolean,
    peer: string | undefined,
    header: string | undefined,
  ) => {
    // The origin proxy overwrites XFF with its real transport peer. A public
    // request cannot nominate its own CDN peer or supply a chain of client IPs.
    const family = peer ? isIP(peer) : 0;
    if (
      !proxyTrusted ||
      !family ||
      !ranges.check(peer!, family === 4 ? "ipv4" : "ipv6") ||
      !header ||
      !isIP(header)
    )
      return peer;
    return isIP(header) === 6
      ? new URL(`http://[${header}]/`).hostname.slice(1, -1)
      : header;
  };
}
