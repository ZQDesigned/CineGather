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
          videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 },
        },
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
