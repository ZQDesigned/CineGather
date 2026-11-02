import {
  esportsOwnVoice,
  ESPORTS_PREWARM_MS,
  type EsportsSnapshot,
  type EsportsChannel,
} from "@cinegather/contracts";
export interface EsportsMediaHandle {
  /** Resolves only after an actual decoded frame, never merely on subscription. */
  ready(signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
  video(enabled: boolean): void;
  audio(enabled: boolean): void;
}
export interface EsportsConnection {
  channel: string;
  url: string;
  token: string;
  seatRevision: number;
}
export interface EsportsDependencies {
  api: {
    connection(
      channel: EsportsChannel,
      seatRevision: number,
      watchRevision?: number,
    ): Promise<EsportsConnection>;
    watch(input: {
      action: "select" | "commit" | "cancel" | "stop";
      publicationId?: string;
      revision: number;
    }): Promise<EsportsSnapshot>;
    monitor(input: {
      enabled?: boolean;
      autoMonitor?: boolean;
    }): Promise<EsportsSnapshot>;
  };
  media: {
    open(
      connection: EsportsConnection,
      kind: "voice" | "video" | "monitor",
      signal: AbortSignal,
    ): Promise<EsportsMediaHandle>;
    show(handle: EsportsMediaHandle | undefined): void;
    muteMicrophone(): Promise<void>;
  };
  changed(state: EsportsClientState): void;
  error(error: unknown): void;
}
export interface EsportsClientState {
  snapshot?: EsportsSnapshot;
  watching?: string;
  warming?: string;
  busy: boolean;
}
interface Slot {
  id: string;
  handle: EsportsMediaHandle;
}
const aborted = () => new DOMException("Cancelled", "AbortError");
export class EsportsCoordinator {
  private snapshot?: EsportsSnapshot;
  private voice?: EsportsMediaHandle;
  private current?: Slot;
  private warming?: Slot;
  private monitorSlot?: Slot;
  private serial: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private warmAbort?: AbortController;
  private lifetime = new AbortController();
  private visible = true;
  private busy = false;
  private events: {
    at: string;
    event: string;
    publicationId?: string;
    seatRevision?: number;
    watchRevision?: number;
  }[] = [];
  constructor(
    private readonly deps: EsportsDependencies,
    private readonly options: { prewarmMs?: number } = {},
  ) {}
  get state(): EsportsClientState {
    return {
      snapshot: this.snapshot,
      watching: this.current?.id,
      warming: this.warming?.id,
      busy: this.busy,
    };
  }
  diagnostics() {
    return {
      roomId: this.snapshot?.roomId,
      seat: this.snapshot?.self.seat,
      seatRevision: this.snapshot?.self.revision,
      watchRevision: this.snapshot?.watch.revision,
      current: this.current?.id,
      warming: this.warming?.id,
      monitorTeam: this.monitorSlot?.id,
      visible: this.visible,
      events: [...this.events],
    };
  }
  private event(event: string, publicationId?: string) {
    this.events.push({
      at: new Date().toISOString(),
      event,
      publicationId,
      seatRevision: this.snapshot?.self.revision,
      watchRevision: this.snapshot?.watch.revision,
    });
    if (this.events.length > 64) this.events.shift();
  }
  private emit() {
    this.deps.changed(this.state);
  }
  private queue<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.serial.then(operation);
    this.serial = work.catch(() => {});
    return work;
  }
  async start(snapshot: EsportsSnapshot) {
    await this.stop();
    this.lifetime = new AbortController();
    return this.queue(async () => {
      this.snapshot = snapshot;
      await this.openVoice();
      this.event("entered");
      this.emit();
    });
  }
  private async openVoice() {
    const s = this.snapshot!;
    await this.deps.media.muteMicrophone();
    if (this.voice) {
      await this.voice.close();
      this.voice = undefined;
    }
    const connection = await this.deps.api.connection(
      esportsOwnVoice(s.self.seat),
      s.self.revision,
    );
    const voice = await this.deps.media.open(
      connection,
      "voice",
      this.lifetime.signal,
    );
    if (this.lifetime.signal.aborted) {
      await voice.close();
      return;
    }
    voice.audio(true);
    this.voice = voice;
  }
  async sync(next: EsportsSnapshot) {
    if (
      this.snapshot &&
      (next.self.revision > this.snapshot.self.revision ||
        (next.self.revision === this.snapshot.self.revision &&
          next.watch.revision >= this.snapshot.watch.revision &&
          ((this.warming && next.watch.warming !== this.warming.id) ||
            (this.current && next.watch.current !== this.current.id))))
    ) {
      ++this.generation;
      this.warmAbort?.abort();
    }
    return this.queue(async () => {
      const previous = this.snapshot;
      if (
        !previous ||
        next.roomId !== previous.roomId ||
        next.self.revision < previous.self.revision ||
        (next.self.revision === previous.self.revision &&
          next.watch.revision < previous.watch.revision)
      )
        return;
      this.snapshot = next;
      if (next.self.revision !== previous.self.revision) {
        await this.deps.media.muteMicrophone();
        await this.closeViews();
        await this.openVoice();
        this.event("seat-changed");
      } else {
        if (this.current && next.watch.current !== this.current.id) {
          await this.closeCurrent();
          await this.closeMonitor();
        }
        if (this.warming && next.watch.warming !== this.warming.id) {
          this.warmAbort?.abort();
          await this.closeWarm();
        }
        await this.syncMonitor();
      }
      this.emit();
    });
  }
  select(publicationId: string): Promise<void> {
    const generation = ++this.generation;
    this.warmAbort?.abort();
    return this.queue(async () => {
      const s = this.snapshot;
      if (!s || s.self.seat.kind === "player")
        throw new Error("选手席不支持观看其他共享");
      if (!this.visible || generation !== this.generation) return;
      if (this.current?.id === publicationId) return;
      await this.cancelWarm();
      const controller = new AbortController();
      this.warmAbort = controller;
      this.busy = true;
      this.emit();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        this.snapshot = await this.deps.api.watch({
          action: "select",
          publicationId,
          revision: this.snapshot!.watch.revision,
        });
        if (generation !== this.generation || controller.signal.aborted)
          throw aborted();
        const s = this.snapshot;
        const connection = await this.deps.api.connection(
          { kind: "video", publicationId },
          s.self.revision,
          s.watch.revision,
        );
        const handle = await this.deps.media.open(
          connection,
          "video",
          controller.signal,
        );
        handle.audio(false);
        handle.video(true);
        this.warming = { id: publicationId, handle };
        this.event("prewarm-start", publicationId);
        this.emit();
        const remaining = Math.max(
          0,
          Math.min(
            this.options.prewarmMs ?? ESPORTS_PREWARM_MS,
            new Date(s.watch.warmDeadline!).getTime() - Date.now(),
          ),
        );
        timer = setTimeout(
          () => controller.abort(new Error("画面预热超时，已保留原画面")),
          remaining,
        );
        await Promise.race([
          handle.ready(controller.signal),
          new Promise<never>((_, reject) => {
            const stop = () => reject(controller.signal.reason ?? aborted());
            if (controller.signal.aborted) stop();
            else
              controller.signal.addEventListener("abort", stop, { once: true });
          }),
        ]);
        if (
          generation !== this.generation ||
          controller.signal.aborted ||
          !this.visible
        )
          throw aborted();
        clearTimeout(timer);
        this.snapshot = await this.deps.api.watch({
          action: "commit",
          publicationId,
          revision: this.snapshot!.watch.revision,
        });
        // The commit RPC is a point of no return: adopt its decoded frame even
        // if a later selection queued while it was in flight. That selection
        // will warm from this committed stream next.
        // Silence and detach old outputs before either new audio path is enabled.
        await this.closeCurrent();
        const next = this.warming!;
        this.warming = undefined;
        this.current = next;
        this.deps.media.show(next.handle);
        next.handle.audio(true);
        next.handle.video(this.visible);
        await this.syncMonitor();
        this.event("prewarm-committed", publicationId);
      } catch (error) {
        try {
          await this.cancelWarm();
        } catch (cleanupError) {
          if (generation === this.generation && !this.lifetime.signal.aborted)
            this.deps.error(cleanupError);
        }
        this.event("prewarm-cancelled", publicationId);
        if (
          generation === this.generation &&
          !(error instanceof DOMException && error.name === "AbortError")
        )
          this.deps.error(error);
      } finally {
        clearTimeout(timer);
        if (this.warmAbort === controller) this.warmAbort = undefined;
        this.busy = false;
        this.emit();
      }
    });
  }
  private async closeWarm() {
    const slot = this.warming;
    this.warming = undefined;
    if (slot) {
      slot.handle.audio(false);
      await slot.handle.close();
    }
  }
  private async cancelWarm() {
    await this.closeWarm();
    if (this.snapshot?.watch.warming)
      this.snapshot = await this.deps.api.watch({
        action: "cancel",
        revision: this.snapshot.watch.revision,
      });
  }
  private async closeCurrent() {
    const slot = this.current;
    this.current = undefined;
    if (slot) {
      slot.handle.audio(false);
      this.deps.media.show(undefined);
      await slot.handle.close();
    }
  }
  private async closeMonitor() {
    const slot = this.monitorSlot;
    this.monitorSlot = undefined;
    if (slot) {
      slot.handle.audio(false);
      await slot.handle.close();
    }
  }
  private async syncMonitor() {
    const s = this.snapshot,
      team = this.current ? s?.watch.monitorTeam : null;
    if (team === this.monitorSlot?.id) return;
    await this.closeMonitor();
    if (!team || !s) return;
    const connection = await this.deps.api.connection(
      { kind: "team", team },
      s.self.revision,
      s.watch.revision,
    );
    const handle = await this.deps.media.open(
      connection,
      "monitor",
      this.lifetime.signal,
    );
    if (this.lifetime.signal.aborted) {
      await handle.close();
      return;
    }
    handle.audio(true);
    this.monitorSlot = { id: team, handle };
    this.event("monitor-connected");
  }
  async monitor(input: { enabled?: boolean; autoMonitor?: boolean }) {
    return this.queue(async () => {
      if (!this.snapshot) return;
      this.snapshot = await this.deps.api.monitor(input);
      await this.syncMonitor();
      this.emit();
    });
  }
  async stopWatching() {
    ++this.generation;
    this.warmAbort?.abort();
    return this.queue(async () => {
      await this.closeViews();
      if (this.snapshot)
        this.snapshot = await this.deps.api.watch({
          action: "stop",
          revision: this.snapshot.watch.revision,
        });
      this.event("watch-stopped");
      this.emit();
    });
  }
  async setVisible(visible: boolean) {
    this.visible = visible;
    this.current?.handle.video(visible);
    if (!visible) {
      ++this.generation;
      this.warmAbort?.abort();
    }
    return this.queue(async () => {
      if (!visible) await this.cancelWarm();
      this.event(visible ? "video-visible" : "video-paused");
      this.emit();
    });
  }
  private async closeViews() {
    await this.closeWarm();
    await this.closeCurrent();
    await this.closeMonitor();
  }
  async stop() {
    ++this.generation;
    this.warmAbort?.abort();
    this.lifetime.abort();
    return this.queue(async () => {
      await this.deps.media.muteMicrophone();
      await this.closeViews();
      if (this.voice) {
        await this.voice.close();
        this.voice = undefined;
      }
      this.snapshot = undefined;
      this.busy = false;
      this.emit();
    });
  }
}
