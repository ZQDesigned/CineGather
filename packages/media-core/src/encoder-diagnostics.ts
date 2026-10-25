import {
  diagnosticVideoCodecSchema,
  encoderCapabilitiesSchema,
  senderDiagnosticSchema,
} from "@cinegather/contracts";
export function diagnosticVideoCodec(codec: Partial<RTCRtpCodecParameters>) {
  const mimeTypes = [
    "video/H264",
    "video/VP8",
    "video/VP9",
    "video/AV1",
    "video/rtx",
    "video/red",
    "video/ulpfec",
  ];
  const mimeType = mimeTypes.find(
    (mime) => mime.toLowerCase() === codec.mimeType?.toLowerCase(),
  );
  if (!mimeType) return undefined;
  const allowed =
    /^(?:profile-level-id=[a-fA-F0-9]{6}|packetization-mode=[01]|level-asymmetry-allowed=[01]|apt=\d{1,3}|profile-id=\d|level-idx=\d{1,2})$/;
  const fmtp = codec.sdpFmtpLine
    ?.split(";")
    .map((p) => p.trim())
    .filter((p) => allowed.test(p))
    .join(";");
  const parsed = diagnosticVideoCodecSchema.safeParse({
    mimeType,
    payloadType: codec.payloadType,
    clockRate: codec.clockRate,
    sdpFmtpLine: fmtp || undefined,
  });
  return parsed.success ? parsed.data : undefined;
}
export function videoCapabilities(
  read: () => RTCRtpCapabilities | null = () =>
    RTCRtpSender.getCapabilities("video"),
) {
  try {
    const caps = read();
    return encoderCapabilitiesSchema.parse({
      status: caps ? "ok" : "unavailable",
      codecs: (caps?.codecs ?? []).slice(0, 64).flatMap((codec) => {
        const value = diagnosticVideoCodec(codec);
        return value ? [value] : [];
      }),
    });
  } catch {
    return { status: "failed" as const, codecs: [] };
  }
}
export function senderDiagnostics(sender?: RTCRtpSender) {
  if (!sender) return { status: "unavailable" as const };
  try {
    const parameters = sender.getParameters();
    return senderDiagnosticSchema.parse({
      status: "ok",
      degradationPreference: parameters.degradationPreference,
      codecs: parameters.codecs.slice(0, 64).flatMap((codec) => {
        const value = diagnosticVideoCodec(codec);
        return value ? [value] : [];
      }),
      encodings: parameters.encodings.slice(0, 8),
    });
  } catch {
    return { status: "failed" as const };
  }
}
