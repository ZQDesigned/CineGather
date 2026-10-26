import { audioDeviceOptions, reconcileAudioDevices } from "../audio-devices";
import {
  App,
  Select,
  Checkbox,
  Progress,
  Form,
  Tabs,
  Alert,
  Switch,
  Slider,
} from "antd";
import { Button, Input } from "./Controls";
import { useEffect, useRef, useState } from "react";
import { Headphones, Mic, Volume2, Monitor, Check, Server } from "lucide-react";
import { useApp, update } from "../store";
import * as actions from "../controller";
import {
  qualityPresets,
  qualityLabel,
  type DesktopSettings,
  type NativeEncoderInventory,
} from "@cinegather/contracts";
import { ModalShell, useDialogOpen } from "./Modal";
import { ShortcutRecorder } from "./ShortcutRecorder";
import { serverOrigin, verifyServer } from "../server-address";
import { defaultOverlayPreferences } from "../../shared/settings";
import { capabilities } from "../platform";
import { AccountForm } from "./AccountForm";
import { UpdatePanel } from "./Updates";
import {
  createMicrophoneDenoiser,
  microphoneConstraints,
} from "@cinegather/media-core";
import type { MicrophoneDenoiser } from "@cinegather/media-core";
export function Settings() {
  const platform = capabilities();
  const user = useApp((s) => s.user);
  const pttLabel = "全局按住说话";
  const muteLabel = platform.globalShortcuts
    ? "全局麦克风静音"
    : "页面内麦克风静音";
  const open = useDialogOpen();
  const [encoderInventory, setEncoderInventory] =
    useState<NativeEncoderInventory>();
  const [encoderError, setEncoderError] = useState(false);
  const sharing = useApp(
    (s) => s.shareState !== "idle" && s.shareState !== "failed",
  );
  useEffect(() => {
    let current = true;
    if (open && window.desktop?.encoders) {
      setEncoderError(false);
      void window.desktop
        .encoders()
        .then((value) => {
          if (current) setEncoderInventory(value);
        })
        .catch(() => {
          if (current) setEncoderError(true);
        });
    }
    return () => {
      current = false;
    };
  }, [open]);
  const { modal } = App.useApp();
  const serverRequest = useRef<AbortController | undefined>(undefined);
  const confirmation = useRef<ReturnType<typeof modal.confirm> | undefined>(
    undefined,
  );
  const [verifying, setVerifying] = useState(false);
  useEffect(() => {
    if (!open) setVerifying(false);
    return () => {
      serverRequest.current?.abort();
      confirmation.current?.destroy();
    };
  }, [open]);
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
                。仍要保存该地址并重新登录吗？
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
  useEffect(() => {
    setSettings((previous) => ({
      ...previous,
      autoDownloadUpdates: current.autoDownloadUpdates,
    }));
  }, [current.autoDownloadUpdates]);
  const devices = useApp((s) => s.audioDevices);
  const [tab, setTab] = useState("audio");
  const [server, setServer] = useState(actions.baseUrl);
  const [testing, setTesting] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const capturePending = useRef(false);
  const testRevision = useRef(0);
  const [level, setLevel] = useState(0);
  const audioRef = useRef<
    | {
        stream: MediaStream;
        context: AudioContext;
        frame: number;
        processor?: MicrophoneDenoiser;
      }
    | undefined
  >(undefined);
  const change = <K extends keyof DesktopSettings>(
    key: K,
    value: DesktopSettings[K],
  ) => setSettings((previous) => ({ ...previous, [key]: value }));
  const refresh = () => {
    void actions.refreshAudioDevices().catch(actions.report);
  };
  useEffect(() => {
    setSettings((previous) => {
      const checked = reconcileAudioDevices(previous, devices);
      return checked.missing.length
        ? {
            ...previous,
            inputDevice: checked.inputDevice,
            outputDevice: checked.outputDevice,
          }
        : previous;
    });
  }, [devices]);
  const savedDevices = useRef({
    input: current.inputDevice,
    output: current.outputDevice,
  });
  useEffect(() => {
    const old = savedDevices.current;
    setSettings((previous) => ({
      ...previous,
      inputDevice:
        previous.inputDevice === old.input
          ? current.inputDevice
          : previous.inputDevice,
      outputDevice:
        previous.outputDevice === old.output
          ? current.outputDevice
          : previous.outputDevice,
    }));
    savedDevices.current = {
      input: current.inputDevice,
      output: current.outputDevice,
    };
  }, [current.inputDevice, current.outputDevice]);
  useEffect(() => {
    if (!open) {
      setTesting(false);
      setRequesting(false);
      setLevel(0);
      return;
    }
    setTesting(false);
    setRequesting(false);
    setLevel(0);
    refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => {
      ++testRevision.current;
      capturePending.current = false;
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
      const active = audioRef.current;
      audioRef.current = undefined;
      if (active) {
        cancelAnimationFrame(active.frame);
        active.stream.getTracks().forEach((t) => t.stop());
        void active.processor?.destroy();
        if (active.context.state !== "closed") void active.context.close();
      }
    };
  }, [open, tab]);
  const testMicrophone = async () => {
    if (capturePending.current) return;
    if (audioRef.current) {
      const active = audioRef.current;
      audioRef.current = undefined;
      cancelAnimationFrame(active.frame);
      active.stream.getTracks().forEach((t) => t.stop());
      await active.processor?.destroy();
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
    let processor: MicrophoneDenoiser | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: settings.inputDevice
            ? { exact: settings.inputDevice }
            : undefined,
          ...microphoneConstraints(settings.noiseReduction),
        },
        video: false,
      });
      if (revision !== testRevision.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      context = new AudioContext();
      audioRef.current = { stream, context, frame: 0 };
      stream.getAudioTracks()[0]?.addEventListener(
        "ended",
        () => {
          if (
            revision !== testRevision.current ||
            audioRef.current?.stream !== stream
          )
            return;
          ++testRevision.current;
          capturePending.current = false;
          const active = audioRef.current;
          if (!active) return;
          audioRef.current = undefined;
          cancelAnimationFrame(active.frame);
          active.stream.getTracks().forEach((track) => track.stop());
          void active.processor?.destroy();
          if (active.context.state !== "closed")
            void active.context.close().catch(() => {});
          setTesting(false);
          setRequesting(false);
          setLevel(0);
          update({ notice: "麦克风测试已中断，请重新连接设备后重试" });
        },
        { once: true },
      );
      let metered = stream;
      if (settings.noiseReduction === "enhanced") {
        processor = await createMicrophoneDenoiser((status) => {
          if (status.reason && revision === testRevision.current)
            update({ notice: "高质量降噪暂不可用，已切换兼容降噪" });
        });
        if (revision !== testRevision.current) {
          stream.getTracks().forEach((track) => track.stop());
          await processor?.destroy();
          if (context.state !== "closed") await context.close();
          return;
        }
        if (!processor)
          await stream
            .getAudioTracks()[0]!
            .applyConstraints({ ...microphoneConstraints("basic") });
        audioRef.current = { stream, context, processor, frame: 0 };
        await processor?.init({
          kind: "audio" as import("livekit-client").Track.Kind.Audio,
          track: stream.getAudioTracks()[0]!,
          audioContext: context,
        });
        if (processor?.processedTrack)
          metered = new MediaStream([processor.processedTrack]);
      }
      if (revision !== testRevision.current) {
        await processor?.destroy();
        stream.getTracks().forEach((track) => track.stop());
        if (context.state !== "closed") await context.close();
        return;
      }
      const analyser = context.createAnalyser();
      context.createMediaStreamSource(metered).connect(analyser);
      const values = new Uint8Array(analyser.frequencyBinCount);
      audioRef.current = { stream, context, processor, frame: 0 };
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
      await processor?.destroy();
      if (context && context.state !== "closed") await context.close();
      if (audioRef.current?.stream === stream) audioRef.current = undefined;
      if (revision === testRevision.current) throw error;
    } finally {
      if (revision === testRevision.current) {
        capturePending.current = false;
        setRequesting(false);
      }
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
          ) : tab !== "account" && tab !== "updates" ? (
            <Button
              type="primary"
              htmlType="submit"
              form={
                tab === "audio"
                  ? "audio-settings"
                  : tab === "overlay"
                    ? "overlay-settings"
                    : "sharing-settings"
              }
              icon={<Check size={17} />}
            >
              保存设置
            </Button>
          ) : null}
        </>
      }
    >
      <Tabs
        className="settings-tabs"
        activeKey={tab}
        onChange={setTab}
        items={[
          ...(window.desktop?.updates
            ? [{ key: "updates", label: "版本更新", children: <UpdatePanel /> }]
            : []),
          ...(user
            ? [
                {
                  key: "account",
                  label: "账号与安全",
                  children: (
                    <>
                      <p className="account-identity">
                        用户名：{user.username}
                      </p>
                      <AccountForm mode="password" />
                    </>
                  ),
                },
              ]
            : []),
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
                {!platform.microphone && (
                  <Alert
                    type="warning"
                    showIcon
                    title="麦克风需要使用 HTTPS 或本机地址，并允许浏览器访问"
                  />
                )}
                <Form.Item label="麦克风">
                  <Select
                    aria-label="麦克风"
                    disabled={!platform.microphone || testing || requesting}
                    value={settings.inputDevice}
                    onChange={(v) => change("inputDevice", v)}
                    options={audioDeviceOptions(
                      "audioinput",
                      devices,
                      settings.inputDevice,
                    )}
                  />
                </Form.Item>
                <Form.Item label="麦克风降噪">
                  <Select
                    aria-label="麦克风降噪"
                    disabled={!platform.microphone || testing || requesting}
                    value={settings.noiseReduction}
                    onChange={(value) => change("noiseReduction", value)}
                    options={[
                      { value: "enhanced", label: "增强降噪" },
                      { value: "basic", label: "基础降噪" },
                      { value: "off", label: "关闭降噪" },
                    ]}
                  />
                </Form.Item>
                <div className="device-test">
                  <Button
                    disabled={!platform.microphone}
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
                    disabled={!platform.outputSelection}
                    value={settings.outputDevice}
                    onChange={(v) => change("outputDevice", v)}
                    options={audioDeviceOptions(
                      "audiooutput",
                      devices,
                      settings.outputDevice,
                    )}
                  />
                </Form.Item>
                <Form.Item label="进退房提示音">
                  <Switch
                    aria-label="进退房提示音"
                    checked={settings.roomSounds ?? true}
                    onChange={(value) => change("roomSounds", value)}
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
                {window.desktop?.platform === "win32" &&
                  window.desktop.encoders && (
                    <Form.Item label="共享编码器">
                      <Select
                        aria-label="共享编码器"
                        value={settings.windowsEncoder ?? "auto"}
                        disabled={sharing}
                        loading={!encoderInventory && !encoderError}
                        onChange={(value) => change("windowsEncoder", value)}
                        options={[
                          { value: "auto", label: "自动选择" },
                          ...(encoderInventory?.encoders ?? []).map(
                            (encoder) => ({
                              value: encoder.id,
                              label:
                                encoder.name +
                                (encoder.available ? "" : "（不可用）"),
                              disabled: !encoder.available,
                            }),
                          ),
                          ...(settings.windowsEncoder &&
                          settings.windowsEncoder !== "auto" &&
                          !encoderInventory?.encoders.some(
                            (e) => e.id === settings.windowsEncoder,
                          )
                            ? [
                                {
                                  value: settings.windowsEncoder,
                                  label: "原编码器已不可用，请重新选择",
                                  disabled: true,
                                },
                              ]
                            : []),
                        ]}
                      />
                      {encoderError && (
                        <Alert
                          type="warning"
                          showIcon
                          title="无法检测编码器，请检查采集组件是否完整"
                        />
                      )}
                    </Form.Item>
                  )}
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
                {platform.pushToTalk && (
                  <Form.Item>
                    <Checkbox
                      checked={settings.pushToTalk}
                      onChange={(e) => change("pushToTalk", e.target.checked)}
                    >
                      按键说话
                    </Checkbox>
                  </Form.Item>
                )}
                <div
                  className={`shortcut-fields${platform.pushToTalk ? "" : " single-shortcut"}`}
                >
                  {platform.pushToTalk && (
                    <Form.Item label={pttLabel}>
                      <ShortcutRecorder
                        label={pttLabel}
                        value={settings.pttShortcut}
                        active={open && tab === "sharing"}
                        onChange={(value) => change("pttShortcut", value)}
                      />
                    </Form.Item>
                  )}
                  <Form.Item label={muteLabel}>
                    <ShortcutRecorder
                      label={muteLabel}
                      value={settings.muteShortcut}
                      active={open && tab === "sharing"}
                      onChange={(value) => change("muteShortcut", value)}
                    />
                  </Form.Item>
                </div>
                {platform.tray && (
                  <Form.Item>
                    <Checkbox
                      checked={settings.minimizeToTray}
                      onChange={(e) =>
                        change("minimizeToTray", e.target.checked)
                      }
                    >
                      关闭窗口后保留在托盘
                    </Checkbox>
                  </Form.Item>
                )}
              </Form>
            ),
          },
          ...(window.desktop?.memberOverlay
            ? [
                {
                  key: "overlay",
                  label: "成员浮层",
                  children: (
                    <Form
                      id="overlay-settings"
                      layout="vertical"
                      onFinish={() =>
                        void actions.run(() => actions.saveSettings(settings))
                      }
                    >
                      <Form.Item label="显示房间成员浮层">
                        <Switch
                          aria-label="显示房间成员浮层"
                          checked={
                            (
                              settings.memberOverlay ??
                              defaultOverlayPreferences
                            ).enabled
                          }
                          onChange={(enabled) =>
                            change("memberOverlay", {
                              ...(settings.memberOverlay ??
                                defaultOverlayPreferences),
                              enabled,
                            })
                          }
                        />
                      </Form.Item>
                      <Form.Item label="浮层背景不透明度">
                        <Slider
                          ariaLabelForHandle="浮层背景不透明度"
                          min={0}
                          max={100}
                          value={
                            (
                              settings.memberOverlay ??
                              defaultOverlayPreferences
                            ).opacity
                          }
                          onChange={(opacity) =>
                            change("memberOverlay", {
                              ...(settings.memberOverlay ??
                                defaultOverlayPreferences),
                              opacity,
                            })
                          }
                          tooltip={{ formatter: (value) => `${value}%` }}
                        />
                      </Form.Item>
                      <Form.Item label="浮层位置">
                        <Select
                          aria-label="浮层位置"
                          value={
                            (
                              settings.memberOverlay ??
                              defaultOverlayPreferences
                            ).position
                          }
                          onChange={(position) =>
                            change("memberOverlay", {
                              ...(settings.memberOverlay ??
                                defaultOverlayPreferences),
                              position,
                            })
                          }
                          options={[
                            { value: "left-top", label: "左上角" },
                            { value: "left-center", label: "左侧居中" },
                            { value: "left-bottom", label: "左下角" },
                            { value: "right-top", label: "右上角" },
                            { value: "right-center", label: "右侧居中" },
                            { value: "right-bottom", label: "右下角" },
                          ]}
                        />
                      </Form.Item>
                    </Form>
                  ),
                },
              ]
            : []),
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
                <Form.Item label="API 地址" extra="更换服务器后需要重新登录。">
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
