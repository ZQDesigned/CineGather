import { Room, RoomEvent, Track } from "livekit-client";
import type { AVMeasurement, AudioSample } from "./audio-measurement";
window.cgJoin = async (token, url) => {
  const room = new Room({ adaptiveStream: false, dynacast: false });
  window.cgRoom = room;
  const ac = new AudioContext({ sampleRate: 48000 });
  await ac.resume();
  await ac.audioWorklet.addModule("/meter.js");
  const audioPulses: { at: number }[] = [];
  let analyzer: AnalyserNode | undefined;
  const meter = (source: AudioNode, label: string) => {
    const filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1200;
    filter.Q.value = 50;
    const processor = new AudioWorkletNode(ac, "pulse-meter"),
      silent = ac.createGain();
    silent.gain.value = 0;
    source
      .connect(filter)
      .connect(processor)
      .connect(silent)
      .connect(ac.destination);
    processor.port.onmessage = (e) => {
      const stamp = ac.getOutputTimestamp();
      audioPulses.push({
        at:
          performance.timeOrigin +
          stamp.performanceTime! +
          (e.data.audioTime - stamp.contextTime!) * 1000,
      });
    };
    return { filter, processor, silent, label };
  };
  const calibration = ac.createOscillator(),
    cg = ac.createGain();
  calibration.frequency.value = 1200;
  cg.gain.value = 0;
  calibration.connect(cg);
  const cm = meter(cg, "calibration"),
    at = ac.currentTime + 0.15;
  cg.gain.setValueAtTime(0.04, at);
  cg.gain.setValueAtTime(0, at + 0.12);
  calibration.start();
  await new Promise((r) => setTimeout(r, 400));
  calibration.stop();
  const stamp = ac.getOutputTimestamp(),
    expected =
      performance.timeOrigin +
      stamp.performanceTime! +
      (at - stamp.contextTime!) * 1000;
  const calibrationMs = audioPulses.length ? audioPulses[0]!.at - expected : 0;
  cm.filter.disconnect();
  cm.processor.disconnect();
  cm.silent.disconnect();
  audioPulses.length = 0;
  room.on(RoomEvent.TrackSubscribed, (track, pub) => {
    if (pub.source === Track.Source.ScreenShare) {
      const video = track.attach() as HTMLVideoElement;
      video.muted = true;
      document.body.append(video);
      window.cgReceived = video;
      void video.play();
    }
    if (pub.source === Track.Source.ScreenShareAudio) {
      const element = track.attach();
      element.volume = 0;
      element.muted = false;
      document.body.append(element);
      void element.play();
      const source = ac.createMediaStreamSource(
        new MediaStream([track.mediaStreamTrack]),
      );
      analyzer = ac.createAnalyser();
      analyzer.fftSize = 8192;
      analyzer.smoothingTimeConstant = 0;
      source.connect(analyzer);
      const silent = ac.createGain();
      silent.gain.value = 0;
      analyzer.connect(silent).connect(ac.destination);
      meter(source, "film");
    }
  });
  room.on(RoomEvent.TrackUnsubscribed, (track) =>
    track.detach().forEach((el) => el.remove()),
  );
  await room.connect(url, token);
  await room.startAudio();
  // This track is genuinely published to the room and played by both CineGather apps.
  const voice = ac.createOscillator(),
    vg = ac.createGain(),
    dest = ac.createMediaStreamDestination();
  voice.frequency.value = 1760;
  vg.gain.value = 0.04;
  voice.connect(vg).connect(dest);
  voice.start();
  await room.localParticipant.publishTrack(dest.stream.getAudioTracks()[0]!, {
    source: Track.Source.Microphone,
    dtx: false,
  });
  window.cgMeasure = async (durationMs) => {
    const video = window.cgReceived!;
    if (!analyzer || !video?.videoWidth) throw Error("No real received media");
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    const result: AVMeasurement = {
      durationMs,
      samples: [],
      audio: [],
      videoPulses: [],
      audioPulses,
      calibrationMs,
    };
    audioPulses.length = 0;
    let marker: { x: number; y: number; width: number } | undefined,
      lastPulse = 0;
    const start = performance.now();
    const poll = setInterval(() => {
      const spectrum = new Float32Array(analyzer!.frequencyBinCount);
      analyzer!.getFloatFrequencyData(spectrum);
      const db = (f: number) => {
        const i = Math.round((f * analyzer!.fftSize) / ac.sampleRate);
        return Math.max(...spectrum.slice(i - 1, i + 2));
      };
      const sample: AudioSample = {
        at: Date.now(),
        film: db(523.25),
        other: db(880),
        voice: db(1760),
        own: db(2200),
      };
      result.audio.push(sample);
    }, 20);
    await new Promise<void>((resolve) => {
      const frame = () => {
        const now = Date.now();
        g.drawImage(video, 0, 0, canvas.width, canvas.height);
        const {
          data: d,
          width: w,
          height: h,
        } = g.getImageData(0, 0, canvas.width, canvas.height);
        if (!marker) {
          for (let y = 0; y < h; y += 2) {
            let run = -1;
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4,
                match = d[i]! > 160 && d[i + 1]! < 110 && d[i + 2]! > 160;
              if (match && run < 0) run = x;
              if ((!match || x === w - 1) && run >= 0) {
                const width = x - run;
                if (width > 300 && (!marker || width > marker.width))
                  marker = { x: run, y, width };
                run = -1;
              }
            }
          }
        }
        if (marker) {
          const scale = marker.width / 1280;
          let stamp = 0n;
          for (let bit = 0; bit < 48; bit++) {
            const x = Math.round(marker.x + (64 + bit * 24 + 12) * scale),
              y = Math.round(marker.y + 45 * scale),
              i = (y * w + x) * 4;
            stamp =
              stamp * 2n + BigInt(d[i]! + d[i + 1]! + d[i + 2]! > 390 ? 1 : 0);
          }
          const age = now - Number(stamp);
          if (age >= 0 && age < 10000) {
            result.samples.push({ at: now, stamp: Number(stamp), age });
            const x = Math.round(marker.x + 640 * scale),
              y = Math.round(marker.y + 175 * scale),
              i = (y * w + x) * 4;
            if (
              d[i]! > 180 &&
              d[i + 1]! > 180 &&
              d[i + 2]! > 180 &&
              now - lastPulse > 1000
            ) {
              lastPulse = now;
              result.videoPulses.push({ at: now, stamp: Number(stamp) });
            }
          } else marker = undefined;
        }
        if (performance.now() - start >= durationMs) resolve();
        else video.requestVideoFrameCallback(frame);
      };
      video.requestVideoFrameCallback(frame);
      setTimeout(resolve, durationMs + 3000);
    });
    clearInterval(poll);
    return result;
  };
};
