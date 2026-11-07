// Runs in a real packaged renderer: validate H.264 constrained-baseline
// negotiation and capture actual encoder evidence without a public room/account.
export async function webRTCEncoderProbe() {
  const sender = new RTCPeerConnection(),
    receiver = new RTCPeerConnection();
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const context = canvas.getContext("2d")!;
  let frame = 0;
  const paint = () => {
    context.fillStyle = `hsl(${frame++ % 360},70%,40%)`;
    context.fillRect(0, 0, 1920, 1080);
    context.fillStyle = "white";
    context.fillRect((frame * 20) % 1700, 400, 200, 200);
  };
  paint();
  const timer = setInterval(paint, 33),
    stream = canvas.captureStream(30);
  const video = document.createElement("video");
  video.muted = true;
  video.autoplay = true;
  video.style.cssText =
    "position:fixed;width:320px;height:180px;bottom:0;left:0";
  document.body.append(video);
  receiver.ontrack = (event) => {
    video.srcObject = new MediaStream([event.track]);
    void video.play();
  };
  const pendingSender: RTCIceCandidateInit[] = [],
    pendingReceiver: RTCIceCandidateInit[] = [];
  sender.onicecandidate = (event) => {
    if (event.candidate) {
      if (receiver.remoteDescription)
        void receiver.addIceCandidate(event.candidate);
      else pendingReceiver.push(event.candidate.toJSON());
    }
  };
  receiver.onicecandidate = (event) => {
    if (event.candidate) {
      if (sender.remoteDescription)
        void sender.addIceCandidate(event.candidate);
      else pendingSender.push(event.candidate.toJSON());
    }
  };
  try {
    const transceiver = sender.addTransceiver(stream.getVideoTracks()[0]!, {
      direction: "sendonly",
    });
    const codecs = RTCRtpSender.getCapabilities("video")!.codecs.filter(
      (codec) =>
        codec.mimeType.toLowerCase() === "video/h264" &&
        /profile-level-id=42e0/i.test(codec.sdpFmtpLine ?? ""),
    );
    if (!codecs.length)
      throw new Error("Constrained-baseline H264 unavailable");
    transceiver.setCodecPreferences(codecs);
    await sender.setLocalDescription(await sender.createOffer());
    await receiver.setRemoteDescription(sender.localDescription!);
    for (const candidate of pendingReceiver.splice(0))
      await receiver.addIceCandidate(candidate);
    await receiver.setLocalDescription(await receiver.createAnswer());
    await sender.setRemoteDescription(receiver.localDescription!);
    for (const candidate of pendingSender.splice(0))
      await sender.addIceCandidate(candidate);
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const outgoing = [...(await sender.getStats()).values()].find(
        (stat) => stat.type === "outbound-rtp" && stat.kind === "video",
      );
      const incoming = [...(await receiver.getStats()).values()].find(
        (stat) => stat.type === "inbound-rtp" && stat.kind === "video",
      );
      if (
        (incoming?.framesDecoded ?? 0) >= 45 &&
        (outgoing?.framesEncoded ?? 0) >= 45
      ) {
        const stats = await sender.getStats(),
          codec = stats.get(outgoing!.codecId);
        return {
          framesEncoded: outgoing!.framesEncoded,
          framesDecoded: incoming!.framesDecoded,
          fps: outgoing!.framesPerSecond,
          width: outgoing!.frameWidth,
          height: outgoing!.frameHeight,
          encoderImplementation: outgoing!.encoderImplementation,
          powerEfficientEncoder: outgoing!.powerEfficientEncoder,
          mimeType: codec?.mimeType,
          sdpFmtpLine: codec?.sdpFmtpLine,
        };
      }
    }
    throw new Error("H264 loopback did not deliver frames within 20 seconds");
  } finally {
    clearInterval(timer);
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    video.remove();
    sender.close();
    receiver.close();
  }
}
