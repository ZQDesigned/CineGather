// Chromium normally excludes constrained-baseline H.264 from the Windows
// platform encoder factory. LiveKit negotiates that profile for interoperability.
// Chromium: third_party/blink/renderer/platform/peerconnection/webrtc_util.cc
// and RTCVideoEncoderFactory::GetSupportedFormats (Windows default is disabled).
const feature = "PlatformH264CbpEncoding";
interface CommandLine {
  getSwitchValue(name: string): string;
  hasSwitch(name: string): boolean;
  appendSwitch(name: string, value?: string): void;
}
function includesFeature(value: string, name: string) {
  return value
    .split(",")
    .some((entry) => entry.trim().split(/[<:*]/)[0] === name);
}
export function configureHardwareEncoding(platform: string, cli: CommandLine) {
  if (platform !== "win32") return;
  const enabled = cli.getSwitchValue("enable-features");
  if (
    includesFeature(enabled, feature) ||
    includesFeature(cli.getSwitchValue("disable-features"), feature)
  )
    return;
  cli.appendSwitch(
    "enable-features",
    [enabled, feature].filter(Boolean).join(","),
  );
}
export function hardwareEncodingPolicy(platform: string, cli: CommandLine) {
  const explicitlyDisabled =
    includesFeature(cli.getSwitchValue("disable-features"), feature) ||
    cli.hasSwitch("disable-accelerated-video-encode") ||
    cli.hasSwitch("disable-gpu");
  return {
    constrainedBaselineHardwareEnabled:
      platform === "win32" &&
      includesFeature(cli.getSwitchValue("enable-features"), feature) &&
      !explicitlyDisabled,
    explicitlyDisabled,
    // This policy enables negotiation; only RTP encoder stats establish actual use.
    gpuBlocklistRespected: true,
    softwareFallbackAllowed: true,
  };
}
