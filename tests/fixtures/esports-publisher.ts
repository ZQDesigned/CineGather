import { Room, LocalVideoTrack, LocalAudioTrack, Track } from "livekit-client";
interface Connection {
  url: string;
  token: string;
}
export async function startEsportsPublisher(
  control: Connection,
  voice: Connection,
  video: Connection,
  { deferFrames = false, label = "选手" } = {},
) {
  const rooms = [
    new Room({ adaptiveStream: false, dynacast: false }),
    new Room({ adaptiveStream: false, dynacast: false }),
    new Room({ adaptiveStream: false, dynacast: false }),
  ];
  await rooms[0]!.connect(control.url, control.token, { autoSubscribe: false });
  await rooms[1]!.connect(voice.url, voice.token, { autoSubscribe: true });
  await rooms[2]!.connect(video.url, video.token, { autoSubscribe: false });
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d")!;
  const stream = canvas.captureStream(0),
    track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  let frame = 0,
    timer: ReturnType<typeof setInterval> | undefined;
  const draw = () => {
    ctx.fillStyle = label.endsWith("A") ? "#173b63" : "#504365";
    ctx.fillRect(0, 0, 1920, 1080);
    ctx.fillStyle = "#e7e7f4";
    ctx.font = "90px sans-serif";
    ctx.fillText(label + " 1080p30", 100, 220);
    ctx.font = "50px monospace";
    ctx.fillText(String(++frame) + " / " + Date.now(), 100, 380);
    ctx.fillStyle = "#bda8f5";
    ctx.fillRect((frame * 17) % 1700, 600, 150, 150);
    track.requestFrame();
  };
  const audio = new AudioContext(),
    tone = audio.createOscillator(),
    gain = audio.createGain(),
    destination = audio.createMediaStreamDestination();
  tone.frequency.value = label.endsWith("A") ? 440 : 660;
  gain.gain.value = 0.000001;
  tone.connect(gain);
  gain.connect(destination);
  tone.start();
  await audio.resume();
  await rooms[1]!.localParticipant.publishTrack(
    new LocalAudioTrack(destination.stream.getAudioTracks()[0]!),
    { name: "赛事测试语音", source: Track.Source.Microphone, dtx: false },
  );
  const start = async () => {
    if (!timer) {
      await rooms[2]!.localParticipant.publishTrack(
        new LocalVideoTrack(track),
        {
          name: "赛事测试画面",
          source: Track.Source.ScreenShare,
          simulcast: false,
          videoCodec: "h264",
          screenShareEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 },
        },
      );
      await rooms[2]!.localParticipant.publishTrack(
        new LocalAudioTrack(destination.stream.getAudioTracks()[0]!.clone()),
        { name: "赛事测试共享声音", source: Track.Source.ScreenShareAudio },
      );
      draw();
      timer = setInterval(draw, 1000 / 30);
    }
  };
  if (!deferFrames) await start();
  return {
    start,
    frames: () => frame,
    close: async () => {
      clearInterval(timer);
      track.stop();
      tone.stop();
      await audio.close();
      await Promise.all(rooms.map((r) => r.disconnect()));
    },
    stats: async () => ({
      frames: frame,
      outbound: [
        ...((
          await rooms[2]!.localParticipant
            .getTrackPublication(Track.Source.ScreenShare)
            ?.track?.getRTCStatsReport()
        )?.values() ?? []),
      ]
        .filter((s) => s.type === "outbound-rtp")
        .map((s) => ({
          type: s.type,
          kind: s.kind,
          framesEncoded: s.framesEncoded,
          framesSent: s.framesSent,
          framesPerSecond: s.framesPerSecond,
          frameWidth: s.frameWidth,
          frameHeight: s.frameHeight,
          bytesSent: s.bytesSent,
          qualityLimitationReason: s.qualityLimitationReason,
        })),
      rooms: rooms.map((r) => ({
        name: r.name,
        state: r.state,
        peers: [...r.remoteParticipants.values()].map((p) => ({
          name: p.name,
          tracks: [...p.trackPublications.values()].map((t) => ({
            source: t.source,
            subscribed: t.isSubscribed,
          })),
        })),
      })),
    }),
  };
}

export async function startEsportsViewer(
  apiOrigin: string,
  roomId: string,
  token: string,
  control: Connection,
) {
  const { EsportsCoordinator } = await import("@cinegather/client-core"),
    { EsportsBrowserMedia } = await import("@cinegather/media-core");
  const summaries = new Map<string, unknown>(),
    errors: string[] = [];
  const parent = new Room();
  await parent.connect(control.url, control.token, { autoSubscribe: false });
  const stage = document.createElement("div");
  Object.assign(stage.style, { width: "640px", height: "360px" });
  document.body.replaceChildren(stage);
  const browser = new EsportsBrowserMedia({
    changed: (value, _kind, channel) => summaries.set(channel, value),
    error: (e) => errors.push(String(e)),
  });
  browser.bind(stage);
  const call = async (path: string, body?: unknown) => {
    const r = await fetch(
      `${apiOrigin}/api/v1/rooms/${roomId}/esports${path}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
          "X-CineGather-Features": "esports-v1",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    const value = await r.json();
    if (!r.ok) throw new Error(value.code);
    return value;
  };
  const coordinator = new EsportsCoordinator({
    api: {
      connection: (channel, seatRevision, watchRevision) =>
        call("/connection", { channel, seatRevision, watchRevision }),
      watch: (body) => call("/watch", body),
      monitor: (body) => call("/monitor", body),
    },
    media: {
      open: (connection, kind, signal) =>
        browser.open(connection, kind, signal),
      show: (h) => browser.show(h),
      muteMicrophone: () => browser.microphone(false),
    },
    changed: () => {},
    error: (e) => errors.push(String(e)),
  });
  await coordinator.start(await call(""));
  return {
    select: (id: string) => coordinator.select(id),
    visible: (value: boolean) => coordinator.setVisible(value),
    stats: async () => ({
      context: coordinator.diagnostics(),
      channels: await browser.diagnostics(),
      summaries: [...summaries.values()],
      errors: [...errors],
      video: [...stage.querySelectorAll("video")].map((v) => ({
        width: v.videoWidth,
        height: v.videoHeight,
        frames: v.getVideoPlaybackQuality().totalVideoFrames,
      })),
    }),
    close: async () => {
      await coordinator.stop();
      await browser.close();
      await parent.disconnect();
    },
  };
}
