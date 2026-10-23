import { App, Select, Checkbox, Progress, Form, Tabs } from "antd";
import { Button, Input } from "./Controls";
import { useEffect, useRef, useState } from "react";
import { Headphones, Mic, Volume2, Monitor, Check, Server } from "lucide-react";
import { useApp, update } from "../store";
import * as actions from "../controller";
import {
  qualityPresets,
  qualityLabel,
  type DesktopSettings,
} from "@cinegather/contracts";
import { ModalShell } from "./Modal";
import { ShortcutRecorder } from "./ShortcutRecorder";
import { serverOrigin, verifyServer } from "../server-address";
export function Settings() {
  const { modal } = App.useApp();
  const serverRequest = useRef<AbortController | undefined>(undefined);
  const confirmation = useRef<ReturnType<typeof modal.confirm> | undefined>(
    undefined,
  );
  const [verifying, setVerifying] = useState(false);
  useEffect(
    () => () => {
      serverRequest.current?.abort();
      confirmation.current?.destroy();
    },
    [],
  );
  const saveServer = async () => {
    if (serverRequest.current) return;
    let origin: string;
    try {
      origin = serverOrigin(server);
    } catch (error) {
      actions.report(error);
      return;
    }
    const request = new AbortController();
    serverRequest.current = request;
    setVerifying(true);
    let verified = true;
    try {
      try {
        await verifyServer(origin, request.signal);
      } catch (error) {
        verified = false;
        if (request.signal.aborted) return;
        confirmation.current = modal.confirm({
          title: "无法验证服务器",
          content: (
            <div className="server-confirmation">
              <p>{origin}</p>
              <p>
                {error instanceof Error ? error.message : "连接失败"}
                。仍要保存该地址并重新建立访客身份吗？
              </p>
            </div>
          ),
          okText: "仍然保存",
          cancelText: "取消保存",
          centered: true,
          focusable: { autoFocusButton: "cancel" },
        });
        const confirmed = await confirmation.current;
        confirmation.current = undefined;
        if (!confirmed || request.signal.aborted) return;
      }
      if (request.signal.aborted) return;
      if (origin === serverOrigin(actions.baseUrl))
        update({
          notice: verified ? "服务器连接正常" : "服务器地址未变更",
          modal: null,
        });
      else actions.configureServer(origin);
    } catch (error) {
      if (!request.signal.aborted) actions.report(error);
    } finally {
      if (serverRequest.current === request) {
        serverRequest.current = undefined;
        if (!request.signal.aborted) setVerifying(false);
      }
    }
  };
  const current = useApp((s) => s.settings);
  const [settings, setSettings] = useState<DesktopSettings>({ ...current });
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [tab, setTab] = useState("audio");
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
      wide
      footer={
        <>
          <Button onClick={() => update({ modal: null })}>取消</Button>
          {tab === "server" ? (
            <Button
              type="primary"
              htmlType="submit"
              form="server-settings"
              loading={verifying}
            >
              {verifying ? "正在验证…" : "保存地址"}
            </Button>
          ) : (
            <Button
              type="primary"
              htmlType="submit"
              form={tab === "audio" ? "audio-settings" : "sharing-settings"}
              icon={<Check size={17} />}
            >
              保存设置
            </Button>
          )}
        </>
      }
    >
      <Tabs
        className="settings-tabs"
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "audio",
            label: "音频设备",
            icon: <Headphones size={16} />,
            children: (
              <Form
                id="audio-settings"
                layout="vertical"
                onFinish={() =>
                  void actions.run(() => actions.saveSettings(settings))
                }
              >
                <Form.Item label="麦克风">
                  <Select
                    aria-label="麦克风"
                    value={settings.inputDevice}
                    onChange={(v) => change("inputDevice", v)}
                    options={[
                      { value: "", label: "系统默认麦克风" },
                      ...devices
                        .filter(
                          (d) =>
                            d.kind === "audioinput" &&
                            Boolean(d.deviceId) &&
                            d.deviceId !== "default",
                        )
                        .map((d, i) => ({
                          value: d.deviceId,
                          label: d.label || `麦克风 ${i + 1}`,
                        })),
                    ]}
                  />
                </Form.Item>
                <div className="device-test">
                  <Button
                    loading={requesting}
                    icon={<Mic size={15} />}
                    onClick={() => void testMicrophone().catch(actions.report)}
                  >
                    {requesting
                      ? "正在请求麦克风…"
                      : testing
                        ? "停止测试"
                        : "测试麦克风"}
                  </Button>
                  <Progress
                    className="meter"
                    percent={Math.round(level * 100)}
                    showInfo={false}
                    size="small"
                    aria-label="麦克风输入电平"
                  />
                </div>
                <Form.Item label="扬声器 / 耳机">
                  <Select
                    aria-label="扬声器 / 耳机"
                    value={settings.outputDevice}
                    onChange={(v) => change("outputDevice", v)}
                    options={[
                      { value: "", label: "系统默认输出" },
                      ...devices
                        .filter(
                          (d) =>
                            d.kind === "audiooutput" &&
                            d.deviceId !== "default",
                        )
                        .map((d, i) => ({
                          value: d.deviceId,
                          label: d.label || `扬声器 / 耳机 ${i + 1}`,
                        })),
                    ]}
                  />
                </Form.Item>
                <Button
                  icon={<Volume2 size={15} />}
                  onClick={() => void beep().catch(actions.report)}
                >
                  播放测试音
                </Button>
              </Form>
            ),
          },
          {
            key: "sharing",
            label: "共享与快捷键",
            icon: <Monitor size={16} />,
            children: (
              <Form
                id="sharing-settings"
                layout="vertical"
                onFinish={() =>
                  void actions.run(() => actions.saveSettings(settings))
                }
              >
                <Form.Item label="默认共享画质">
                  <Select
                    aria-label="默认共享画质"
                    value={settings.quality}
                    onChange={(v) => change("quality", v)}
                    options={Object.entries(qualityPresets).map(([value]) => ({
                      value: value as DesktopSettings["quality"],
                      label: qualityLabel(value as DesktopSettings["quality"]),
                    }))}
                  />
                </Form.Item>
                <Form.Item>
                  <Checkbox
                    checked={settings.pushToTalk}
                    onChange={(e) => change("pushToTalk", e.target.checked)}
                  >
                    按键说话
                  </Checkbox>
                </Form.Item>
                <div className="shortcut-fields">
                  <Form.Item label="全局按住说话">
                    <ShortcutRecorder
                      label="全局按住说话"
                      value={settings.pttShortcut}
                      active={tab === "sharing"}
                      onChange={(value) => change("pttShortcut", value)}
                    />
                  </Form.Item>
                  <Form.Item label="全局麦克风静音">
                    <ShortcutRecorder
                      label="全局麦克风静音"
                      value={settings.muteShortcut}
                      active={tab === "sharing"}
                      onChange={(value) => change("muteShortcut", value)}
                    />
                  </Form.Item>
                </div>
                <Form.Item>
                  <Checkbox
                    checked={settings.minimizeToTray}
                    onChange={(e) => change("minimizeToTray", e.target.checked)}
                  >
                    关闭窗口后保留在托盘
                  </Checkbox>
                </Form.Item>
              </Form>
            ),
          },
          {
            key: "server",
            label: "自托管服务器",
            icon: <Server size={16} />,
            children: (
              <Form
                id="server-settings"
                layout="vertical"
                onFinish={() => void saveServer()}
              >
                <Form.Item
                  label="API 地址"
                  extra="更换服务器会清除当前访客身份，请确认地址后保存。"
                >
                  <Input
                    aria-label="API 地址"
                    value={server}
                    disabled={verifying}
                    onChange={(e) => setServer(e.target.value)}
                    placeholder="https://api.example.com"
                    required
                  />
                </Form.Item>
              </Form>
            ),
          },
        ]}
      />
    </ModalShell>
  );
}
