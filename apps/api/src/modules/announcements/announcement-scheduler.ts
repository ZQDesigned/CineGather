import type { OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import {
  reconcileAnnouncements,
  subscribeAnnouncements,
  announceScheduleChange,
} from "./announcements";
export class AnnouncementScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private running = false;
  private again = false;
  private active?: string;
  private unsubscribe?: () => void;
  onModuleInit() {
    this.unsubscribe = subscribeAnnouncements(() => {
      if (this.running) this.again = true;
      else this.schedule(0);
    });
    void this.run();
  }
  private schedule(delay: number) {
    clearTimeout(this.timer);
    if (!this.disposed) {
      this.timer = setTimeout(() => void this.run(), Math.max(25, delay));
      this.timer.unref();
    }
  }
  private async run() {
    if (this.disposed || this.running) return;
    this.running = true;
    let delay = 60_000;
    try {
      const next = await reconcileAnnouncements();
      delay = next.next - Date.now() + 25;
      if (this.active !== next.active) {
        this.active = next.active;
        announceScheduleChange();
      }
    } catch {
      delay = 5000;
    } finally {
      this.running = false;
      if (!this.disposed) this.schedule(this.again ? 0 : delay);
      this.again = false;
    }
  }
  onModuleDestroy() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.unsubscribe?.();
  }
}
