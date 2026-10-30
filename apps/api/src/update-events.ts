import { subscribeAnnouncements } from "./announcements";
import type { OnModuleDestroy } from "@nestjs/common";
import { readFile, stat } from "node:fs/promises";
import { watchFile, unwatchFile } from "node:fs";
import { join } from "node:path";
import type { Request, Response } from "express";
import type { ClientPolicy } from "@cinegather/contracts";
export class UpdateEvents implements OnModuleDestroy {
  private clients = new Set<{
    response: Response;
    channel: string;
    ip: string;
    timer: ReturnType<typeof setInterval>;
  }>();
  private snapshots = new Map<string, string>();
  private watchers = new Map<string, () => void>();
  private revisions = new Map<string, number>();
  private disposed = false;
  private unsubscribeAnnouncements?: () => void;
  start(directory: string) {
    this.unsubscribeAnnouncements = subscribeAnnouncements(() => {
      for (const client of this.clients)
        this.send(client.response, "announcements", "{}");
    });
    for (const channel of [
      "win32-x64",
      "win32-arm64",
      "darwin-x64",
      "darwin-arm64",
    ]) {
      const file = join(directory, channel + ".json");
      const refresh = () => {
        void this.refresh(file, channel);
      };
      this.watchers.set(file, refresh);
      watchFile(file, { interval: 1000, persistent: false }, refresh);
      refresh();
    }
  }
  private async refresh(file: string, channel: string) {
    const revision = (this.revisions.get(channel) ?? 0) + 1;
    this.revisions.set(channel, revision);
    try {
      if ((await stat(file)).size > 65536) return;
      const raw = await readFile(file, "utf8");
      // Authentication belongs to the client. The server forwards the signed envelope, never executable URLs.
      const parsed = JSON.parse(raw);
      if (
        typeof parsed.payload !== "string" ||
        typeof parsed.signature !== "string"
      )
        return;
      const snapshot = JSON.stringify(parsed);
      if (
        this.disposed ||
        this.revisions.get(channel) !== revision ||
        snapshot === this.snapshots.get(channel)
      )
        return;
      this.snapshots.set(channel, snapshot);
      for (const client of this.clients)
        if (client.channel === channel)
          this.send(client.response, "release", snapshot);
    } catch {
      /* A missing channel or incomplete publication is not an update. */
    }
  }
  private send(response: Response, event: string, data: string) {
    if (response.destroyed || response.writableEnded) return;
    if (response.writableLength > 256 * 1024) {
      response.end();
      return;
    }
    response.write(`event: ${event}\ndata: ${data}\n\n`);
  }
  connect(request: Request, response: Response, policy: () => ClientPolicy) {
    const platform = String(request.query.platform ?? "web"),
      arch = String(request.query.arch ?? "x64");
    if (
      !["win32", "darwin", "web"].includes(platform) ||
      !["x64", "arm64"].includes(arch)
    )
      return response.status(400).end();
    const ip = request.ip ?? "";
    if (
      this.clients.size >= 1000 ||
      [...this.clients].filter((c) => c.ip === ip).length >= 25
    )
      return response.status(503).setHeader("Retry-After", "60").end();
    response.status(200).set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });
    response.flushHeaders();
    let lastPolicy = JSON.stringify(policy());
    this.send(response, "policy", lastPolicy);
    this.send(response, "announcements", "{}");
    const channel = platform + "-" + arch;
    const timer = setInterval(() => {
      const next = JSON.stringify(policy());
      if (next !== lastPolicy) {
        lastPolicy = next;
        this.send(response, "policy", next);
      }
      if (!response.destroyed && !response.writableEnded)
        response.write(": keepalive\n\n");
    }, 25000);
    timer.unref();
    const client = { response, channel, ip, timer };
    this.clients.add(client);
    const snapshot = this.snapshots.get(channel);
    if (snapshot) this.send(response, "release", snapshot);
    response.once("close", () => {
      clearInterval(timer);
      this.clients.delete(client);
    });
  }
  onModuleDestroy() {
    this.disposed = true;
    this.unsubscribeAnnouncements?.();
    for (const [file, listener] of this.watchers) unwatchFile(file, listener);
    this.watchers.clear();
    for (const client of this.clients) {
      clearInterval(client.timer);
      client.response.end();
    }
    this.clients.clear();
  }
}
