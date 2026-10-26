import { randomUUID } from "node:crypto";
import type { ProcessAudioStart } from "@cinegather/contracts";
export interface AudioApplication {
  key: string;
  name: string;
  target: string;
  identity: string;
}
// Renderer receives one-shot opaque grants, never arbitrary PIDs or bundle IDs.
export class AccompanimentHost {
  private choices = new Map<string, AudioApplication>();
  private expires = 0;
  private generation = 0;
  private request?: string;
  constructor(
    private readonly native: {
      list(): Promise<AudioApplication[]>;
      start(target: string): Promise<ProcessAudioStart>;
      stop(): void;
    },
  ) {}
  async sources() {
    const applications = await this.native.list();
    this.choices.clear();
    this.expires = Date.now() + 60000;
    return applications.slice(0, 200).map((application) => {
      const id = randomUUID();
      this.choices.set(id, application);
      return { id, name: application.name };
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
    return result;
  }
  stop(request?: string) {
    if (request !== undefined && request !== this.request) return;
    ++this.generation;
    this.request = undefined;
    this.native.stop();
  }
}
