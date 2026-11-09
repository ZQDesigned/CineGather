import { createHmac, randomUUID } from "node:crypto";
import type {
  AccompanimentSource,
  ProcessAudioStart,
} from "@cinegather/contracts";
import { identifyAccompanimentApplication } from "./accompaniment-applications";
export interface AudioApplication {
  key: string;
  name: string;
  target: string;
  identity: string;
  executable?: string;
}
// Renderer receives one-shot opaque grants, never arbitrary PIDs or bundle IDs.
export class AccompanimentHost {
  private choices = new Map<string, AudioApplication>();
  private expires = 0;
  private generation = 0;
  private request?: string;
  private active?: AudioApplication;
  private readonly selectionSalt = randomUUID();
  constructor(
    private readonly native: {
      list(): Promise<AudioApplication[]>;
      start(target: string): Promise<ProcessAudioStart>;
      stop(): void;
    },
  ) {}
  private selectionKey(application: AudioApplication) {
    return createHmac("sha256", this.selectionSalt)
      .update(
        JSON.stringify([
          application.key,
          application.identity,
          application.target,
        ]),
      )
      .digest("hex");
  }
  async sources(): Promise<AccompanimentSource[]> {
    const applications = (await this.native.list()).slice(0, 200);
    const active = this.active;
    // Tray applications can disappear from window/audio-session enumeration while
    // process-tree capture is still running. Retain the actual capture for display.
    if (
      active &&
      !applications.some(
        (application) =>
          this.selectionKey(application) === this.selectionKey(active),
      )
    ) {
      if (applications.length === 200) applications.pop();
      applications.push(active);
    }
    this.choices.clear();
    this.expires = Date.now() + 60000;
    return applications.map((application) => {
      const id = randomUUID();
      this.choices.set(id, application);
      const kind = identifyAccompanimentApplication(application);
      const selectionKey = this.selectionKey(application);
      return {
        id,
        selectionKey,
        name: application.name,
        ...(kind ? { application: kind } : {}),
        ...(this.active && this.selectionKey(this.active) === selectionKey
          ? { active: true }
          : {}),
      };
    });
  }
  async start(id: string, request: string) {
    const selected = this.choices.get(id);
    if (!selected || this.expires < Date.now())
      throw new Error("请刷新列表并重新选择伴奏应用");
    this.choices.delete(id);
    this.stop();
    this.request = request;
    const generation = this.generation;
    const applications = await this.native.list();
    if (generation !== this.generation) throw new Error("伴奏已停止");
    const live = applications.find(
      (a) =>
        a.key === selected.key &&
        a.identity === selected.identity &&
        a.target === selected.target,
    );
    if (!live) throw new Error("伴奏应用已关闭，请重新选择");
    const result = await this.native.start(live.target);
    if (generation !== this.generation) throw new Error("伴奏已停止");
    this.active = { ...live };
    return result;
  }
  stop(request?: string) {
    if (request !== undefined && request !== this.request) return;
    ++this.generation;
    this.request = undefined;
    this.active = undefined;
    this.native.stop();
  }
}
