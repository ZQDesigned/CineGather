import { useEffect, useRef, useState } from "react";
import { Headphones, Mic, Volume2, Monitor, Check, Server } from "lucide-react";
import { useApp } from "../store";
import * as actions from "../controller";
import { qualityPresets, type DesktopSettings } from "@cinegather/contracts";
import { ModalShell } from "./Modal";
export function Settings() {
  const current = useApp((s) => s.settings);
  const [settings, setSettings] = useState<DesktopSettings>({ ...current });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [server, setServer] = useState(actions.baseUrl);
  const [testing, setTesting] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const capturePending = useRef(false);
  const testRevision = useRef(0);
  const [level, setLevel] = useState(0);
  const audioRef = useRef<
    { stream: MediaStream; context: AudioContext; frame: number } | undefined
  >(undefined);
  const change = <K extends keyof DesktopSettings>(
    key: K,
    value: DesktopSettings[K],
  ) => setSettings((previous) => ({ ...previous, [key]: value }));
  const refresh = () => {
    void navigator.mediaDevices
      .enumerateDevices()
      .then(setDevices)
      .catch(actions.report);
  };
  useEffect(() => {
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      ++testRevision.current;
      navigator.mediaDevices.removeEventListener("devicechange", refresh);
      const active = audioRef.current;
      if (active) {
        cancelAnimationFrame(active.frame);
        active.stream.getTracks().forEach((t) => t.stop());
        void active.context.close();
      }
    };
  }, []);
  const testMicrophone = async () => {
    if (capturePending.current) return;
    if (audioRef.current) {
      const active = audioRef.current;
      audioRef.current = undefined;
      cancelAnimationFrame(active.frame);
      active.stream.getTracks().forEach((t) => t.stop());
      await active.context.close();
      setTesting(false);
      setLevel(0);
      return;
    }
    capturePending.current = true;
    setRequesting(true);
    const revision = ++testRevision.current;
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: settings.inputDevice
            ? { exact: settings.inputDevice }
            : undefined,
          echoCancellation: true,
        },
        video: false,
      });
      if (revision !== testRevision.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      context = new AudioContext();
      const analyser = context.createAnalyser();
      context.createMediaStreamSource(stream).connect(analyser);
      const values = new Uint8Array(analyser.frequencyBinCount);
      audioRef.current = { stream, context, frame: 0 };
      setTesting(true);
      refresh();
      const tick = () => {
        if (!audioRef.current) return;
        analyser.getByteFrequencyData(values);
        setLevel(
          Math.min(
            1,
            values.reduce((sum, n) => sum + n, 0) / values.length / 100,
          ),
        );
        audioRef.current.frame = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      await context?.close();
      audioRef.current = undefined;
      if (revision === testRevision.current) throw error;
    } finally {
      capturePending.current = false;
      if (revision === testRevision.current) setRequesting(false);
    }
  };
  const beep = async () => {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const destination = context.createMediaStreamDestination();
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.frequency.value = 440;
    gain.gain.value = 0.12;
    const player = new Audio();
    player.srcObject = destination.stream;
    try {
      if (settings.outputDevice && "setSinkId" in player)
        await player.setSinkId(settings.outputDevice);
      await player.play();
      oscillator.start();
      await new Promise((resolve) => setTimeout(resolve, 450));
      oscillator.stop();
    } finally {
      player.pause();
      player.srcObject = null;
      destination.stream.getTracks().forEach((t) => t.stop());
      await context.close();
    }
  };
  return (
    <ModalShell
      title="设置与设备"
      subtitle="让声音、画面和你的习惯刚刚好。"
      wide
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void actions.run(() => actions.saveSettings(settings));
        }}
      >
        <div className="settings-grid">
          <section>
            <h3>
              <Headphones size={17} />
              音频设备
            </h3>
            <label>
              麦克风
              <select
                value={settings.inputDevice}
                onChange={(event) => change("inputDevice", event.target.value)}
              >
                <option value="">系统默认麦克风</option>
                {devices
                  .filter(
                    (d) => d.kind === "audioinput" && d.deviceId !== "default",
                  )
                  .map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `麦克风 ${i + 1}`}
                    </option>
                  ))}
              </select>
            </label>
            <div className="device-test">
              <button
                type="button"
                className="secondary"
                disabled={requesting}
                onClick={() => void testMicrophone().catch(actions.report)}
              >
                <Mic size={15} />
                {requesting
                  ? "正在请求麦克风…"
                  : testing
                    ? "停止测试"
                    : "测试麦克风"}
              </button>
              <div className="meter">
                <span style={{ width: `${level * 100}%` }} />
              </div>
            </div>
            <label>
              扬声器 / 耳机
              <select
                value={settings.outputDevice}
                onChange={(event) => change("outputDevice", event.target.value)}
              >
                <option value="">系统默认输出</option>
                {devices
                  .filter(
                    (d) => d.kind === "audiooutput" && d.deviceId !== "default",
                  )
                  .map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `输出设备 ${i + 1}`}
                    </option>
                  ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() => void beep().catch(actions.report)}
            >
              <Volume2 size={15} />
              播放测试音
            </button>
          </section>
          <section>
            <h3>
              <Monitor size={17} />
              共享与快捷键
            </h3>
            <label>
              默认共享画质
              <select
                value={settings.quality}
                onChange={(event) =>
                  change(
                    "quality",
                    event.target.value as DesktopSettings["quality"],
                  )
                }
              >
                {Object.entries(qualityPresets).map(([key, p]) => (
                  <option key={key} value={key}>
                    {p.label} · {p.width === 1920 ? "1080p" : "720p"} /{" "}
                    {p.frameRate} fps
                  </option>
                ))}
              </select>
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={settings.pushToTalk}
                onChange={(event) => change("pushToTalk", event.target.checked)}
              />
              <span>
                按键说话<small>窗口内按住空格；后台使用下方全局切换键。</small>
              </span>
            </label>
            <label>
              全局切换说话
              <input
                value={settings.pttShortcut}
                onChange={(event) => change("pttShortcut", event.target.value)}
                maxLength={64}
              />
            </label>
            <label>
              全局麦克风静音
              <input
                value={settings.muteShortcut}
                onChange={(event) => change("muteShortcut", event.target.value)}
                maxLength={64}
              />
            </label>
            <label className="check-label">
              <input
                type="checkbox"
                checked={settings.minimizeToTray}
                onChange={(event) =>
                  change("minimizeToTray", event.target.checked)
                }
              />
              <span>
                关闭窗口后保留在托盘
                <small>语音继续运行，可从托盘停止共享或退出。</small>
              </span>
            </label>
          </section>
        </div>
        <p className="form-note">
          1080p / 60fps 为目标档位，实际帧率会随设备和网络调整。快捷键使用
          Electron Accelerator 格式。
        </p>
        <button className="primary wide" type="submit">
          保存设置
          <Check size={17} />
        </button>
      </form>
      <div className="server-config">
        <h3>
          <Server size={16} />
          自托管服务器
        </h3>
        <label>
          API 地址
          <input
            value={server}
            onChange={(event) => setServer(event.target.value)}
            placeholder="https://api.example.com"
          />
        </label>
        <button
          className="secondary"
          onClick={() => {
            try {
              actions.configureServer(server);
            } catch (error) {
              actions.report(error);
            }
          }}
        >
          保存地址并重新建立身份
        </button>
      </div>
    </ModalShell>
  );
}
