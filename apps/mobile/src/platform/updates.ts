import { AppState, Linking, Platform } from "react-native";
import Constants from "expo-constants";
import mobileRelease from "../../mobile-release.json";
import * as SecureStore from "expo-secure-store";
import { requireOptionalNativeModule } from "expo-modules-core";
import { fetch as streamFetch } from "expo/fetch";
import {
  MobileUpdater,
  watchUpdateEvents,
  type MobileUpdateIdentity,
} from "@cinegather/client-core";
import { mobileUpdatePolicySchema } from "@cinegather/contracts";
import type * as ExpoUpdates from "expo-updates";
import { CriticalTimers } from "livekit-client";
import { appendDiagnostic } from "./journal";
// Older installed developer clients must remain bootable while Metro delivers new JS.
const native = requireOptionalNativeModule("ExpoUpdates");
const engine: typeof ExpoUpdates | undefined = native
  ? // eslint-disable-next-line @typescript-eslint/no-require-imports -- Optional native module across development binary upgrades.
    require("expo-updates")
  : undefined;
const extra = Constants.expoConfig?.extra?.mobileUpdate;
export const mobileUpdateIdentity: MobileUpdateIdentity = {
  platform: Platform.OS === "ios" ? "ios" : "android",
  channel: extra?.channel === "preview" ? "preview" : "stable",
  runtime: engine?.runtimeVersion ?? "development",
  build: Number(
    Constants.nativeBuildVersion ??
      (Platform.OS === "ios"
        ? Constants.expoConfig?.ios?.buildNumber
        : Constants.expoConfig?.android?.versionCode) ??
      0,
  ),
  revision: Number(extra?.revision ?? 1),
};
export const mobileCodeVersion = String(
  extra?.version ?? Constants.expoConfig?.version ?? mobileRelease.version,
);
export class MobileUpdateService {
  readonly updater: MobileUpdater;
  private started = false;
  private lastCheck = 0;
  private hintTimer?: ReturnType<typeof setTimeout>;
  private lastHint = 0;
  private readonly origin: string;
  private readonly key: string;
  private forcedWrite = Promise.resolve();
  constructor(
    private readonly leave: () => Promise<void>,
    apiOrigin: string,
  ) {
    this.origin = String(extra?.origin ?? apiOrigin).replace(/\/$/, "");
    this.key = `cinegather.updates.${encodeURIComponent(this.origin).replace(/%/g, "_")}.${mobileUpdateIdentity.channel}.${mobileUpdateIdentity.runtime}`;
    this.updater = new MobileUpdater({
      identity: mobileUpdateIdentity,
      enabled: !__DEV__ && !!engine?.isEnabled,
      latest: async () => {
        const query = new URLSearchParams({
          platform: mobileUpdateIdentity.platform,
          channel: mobileUpdateIdentity.channel,
          runtime: mobileUpdateIdentity.runtime,
        });
        const response = await fetch(
          `${this.origin}/api/v1/mobile-updates/policy?${query}`,
          {
            signal: AbortSignal.timeout(15000),
            headers: { Accept: "application/json" },
            redirect: "error",
            cache: "no-store",
          },
        );
        if (response.status === 204 || response.status === 404) return;
        if (!response.ok) throw Error("无法读取更新策略");
        const raw = await response.text();
        if (raw.length > 65536) throw Error("更新策略过大");
        return mobileUpdatePolicySchema.parse(JSON.parse(raw));
      },
      download: async () => {
        if (!engine) throw Error("更新模块不可用");
        const result = await engine.fetchUpdateAsync();
        if (
          !result.isNew ||
          !result.manifest ||
          !("runtimeVersion" in result.manifest)
        )
          throw Error("未获得兼容的更新");
        const manifest = result.manifest;
        return {
          id: manifest.id,
          runtime: manifest.runtimeVersion,
          revision: Number(
            manifest.extra?.expoClient?.extra?.mobileUpdate?.revision ?? 0,
          ),
        };
      },
      leave,
      reload: async () => {
        if (!engine) throw Error("更新模块不可用");
        await engine.reloadAsync();
      },
      read: async () => {
        const value = await SecureStore.getItemAsync(this.key);
        return value
          ? mobileUpdatePolicySchema.parse(JSON.parse(value))
          : undefined;
      },
      write: async (policy) => {
        await SecureStore.setItemAsync(this.key, JSON.stringify(policy));
      },
      trace: (value) => this.trace(value),
    });
  }
  private trace(value: Record<string, unknown>) {
    try {
      appendDiagnostic({ time: Date.now(), ...value });
    } catch {
      /* diagnostics cannot prevent an update */
    }
  }
  async check(manual = false) {
    const now = Date.now();
    if (!manual && now - this.lastCheck < 60000) return;
    this.lastCheck = now;
    await this.updater.check();
  }
  require(kind: "hot" | "package") {
    if (__DEV__ || !engine?.isEnabled) return;
    const alreadyRequired = this.updater.snapshot().required;
    this.updater.require(kind);
    if (!alreadyRequired)
      void this.leave().catch(() =>
        this.trace({ event: "mobile-update.disconnect-failed" }),
      );
    this.forcedWrite = this.forcedWrite
      .catch(() => {})
      .then(() =>
        SecureStore.setItemAsync(
          this.key + ".required",
          JSON.stringify({
            kind,
            revision: mobileUpdateIdentity.revision,
            build: mobileUpdateIdentity.build,
          }),
        ),
      );
    this.hint();
  }
  private hint() {
    if (this.hintTimer) return;
    const delay = Math.max(0, 5000 - (Date.now() - this.lastHint));
    this.hintTimer = setTimeout(() => {
      this.hintTimer = undefined;
      this.lastHint = Date.now();
      void this.check(true);
    }, delay);
  }
  start() {
    if (this.started) return;
    this.started = true;
    void (async () => {
      await this.updater.restore();
      const pending = await SecureStore.getItemAsync(
        this.key + ".required",
      ).catch(() => null);
      if (pending) {
        try {
          const saved = JSON.parse(pending);
          if (
            (saved.kind === "hot" || saved.kind === "package") &&
            saved.revision === mobileUpdateIdentity.revision &&
            saved.build === mobileUpdateIdentity.build
          )
            this.updater.require(saved.kind);
        } catch {
          /* A marker from another build cannot re-lock a successful update. */
        }
      }
      await this.check();
    })();
    if (__DEV__ || !engine?.isEnabled) return;
    const events = watchUpdateEvents(
      `${this.origin}/api/v1/client-events?platform=${mobileUpdateIdentity.platform}&arch=arm64`,
      (event) => {
        if (event === "mobile-update") this.hint();
        else if (event === "policy") void this.check();
      },
      streamFetch as typeof fetch,
    );
    CriticalTimers.setInterval(
      () => {
        void this.check();
      },
      60 * 60 * 1000,
    );
    AppState.addEventListener("change", (state) => {
      if (state === "active") {
        events.reconnect();
        void this.check();
      }
    });
    this.updater.subscribe(() => {
      const state = this.updater.snapshot();
      if (state.policy && !state.required) {
        this.forcedWrite = this.forcedWrite
          .catch(() => {})
          .then(() => SecureStore.deleteItemAsync(this.key + ".required"));
      }
    });
  }
  async openPackage() {
    const url = this.updater.snapshot().policy?.native.url;
    if (!url)
      throw Error(
        Platform.OS === "ios"
          ? "当前为开发分发，请联系开发者安装新版。"
          : "新版安装包暂未提供，请稍后重试。",
      );
    if (new URL(url).protocol !== "https:") throw Error("安装地址无效");
    await Linking.openURL(url);
  }
  async diagnostics() {
    return {
      identity: mobileUpdateIdentity,
      version: mobileCodeVersion,
      enabled: engine?.isEnabled ?? false,
      updateId: engine?.updateId,
      embedded: engine?.isEmbeddedLaunch,
      emergencyReason: engine?.emergencyLaunchReason,
      state: this.updater.snapshot(),
      logs: await engine?.readLogEntriesAsync(3600000).catch(() => []),
    };
  }
}
