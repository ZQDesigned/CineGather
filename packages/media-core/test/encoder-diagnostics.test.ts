import { expect, test } from "bun:test";
import {
  videoCapabilities,
  senderDiagnostics,
} from "../src/encoder-diagnostics";
test("sender parameters keep codec/scalability constraints without raw SDP, CNAMEs or arbitrary fmtp parameters", () => {
  const sender = {
    getParameters: () => ({
      transactionId: "secret",
      rtcp: { cname: "private" },
      degradationPreference: "maintain-resolution",
      codecs: [
        {
          mimeType: "video/H264",
          payloadType: 108,
          clockRate: 90000,
          sdpFmtpLine:
            "profile-level-id=42e01f;packetization-mode=1;private=secret",
        },
      ],
      encodings: [
        {
          active: true,
          maxBitrate: 6000000,
          maxFramerate: 30,
          scalabilityMode: "L1T1",
          ssrc: 111,
          rid: "private",
        },
      ],
    }),
  };
  const report = senderDiagnostics(sender as unknown as RTCRtpSender);
  expect(report).toMatchObject({
    status: "ok",
    degradationPreference: "maintain-resolution",
    codecs: [{ sdpFmtpLine: "profile-level-id=42e01f;packetization-mode=1" }],
    encodings: [{ maxBitrate: 6000000, scalabilityMode: "L1T1" }],
  });
  expect(JSON.stringify(report)).not.toMatch(/private|secret|cname|ssrc/);
  expect(
    senderDiagnostics({
      getParameters() {
        throw new Error("Bearer secret");
      },
    } as unknown as RTCRtpSender),
  ).toEqual({ status: "failed" });
  expect(videoCapabilities(() => null)).toEqual({
    status: "unavailable",
    codecs: [],
  });
});
