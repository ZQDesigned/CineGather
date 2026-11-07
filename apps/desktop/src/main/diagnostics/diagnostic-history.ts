import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import {
  diagnosticRetentionMs,
  safeDiagnosticRecord,
  type DiagnosticRecord,
  type DiagnosticIssue,
  type DiagnosticHistoryStatus,
} from "@cinegather/contracts";

// Minute shards bound crash loss to an incomplete final line. Writes are incremental,
// serialized and bounded; failures never propagate into the media path.
export class DiagnosticHistory {
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private failures = 0;
  private corruptRecords = 0;
  private dropped = 0;
  private fallback: DiagnosticRecord[] = [];
  private lastPrune = 0;
  private fallbackBytes = 0;
  private remember(entry: DiagnosticRecord, code: DiagnosticIssue["code"]) {
    const safe = {
      ...entry,
      issues: [
        ...(entry.issues ?? []).slice(0, 63),
        { stage: "storage" as const, code },
      ],
    };
    this.fallback.push(safe);
    this.fallbackBytes += JSON.stringify(safe).length * 2;
    this.pruneFallback();
  }
  private pruneFallback() {
    while (
      this.fallback.length &&
      (this.fallback.length > 7200 ||
        this.fallbackBytes > 64 * 1024 * 1024 ||
        this.fallback[0]!.at < this.now() - diagnosticRetentionMs)
    ) {
      const value = this.fallback.shift()!;
      this.fallbackBytes -= JSON.stringify(value).length * 2;
      this.dropped++;
    }
  }
  constructor(
    private directory: string,
    private now = Date.now,
    private maxBytes = 256 * 1024 * 1024,
  ) {}
  async files() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    return (await readdir(this.directory))
      .filter((name) => /^\d{13}\.ndjson$/.test(name))
      .sort();
  }
  append(value: unknown): Promise<boolean> {
    let entry: DiagnosticRecord;
    try {
      entry = safeDiagnosticRecord(value);
    } catch {
      this.dropped++;
      return Promise.resolve(false);
    }
    if (this.pending >= 8) {
      this.remember(entry, "queue-full");
      return Promise.resolve(false);
    }
    this.pending++;
    const task = this.queue
      .then(async () => {
        const now = this.now();
        const file = `${Math.floor(now / 60_000) * 60_000}.ndjson`;
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        // The leading newline also separates any torn record left by a prior crash.
        await appendFile(
          join(this.directory, file),
          `\n${JSON.stringify(entry)}\n`,
          { mode: 0o600 },
        );
        if (now - this.lastPrune >= 60_000) {
          await this.prune();
          this.lastPrune = now;
        }
        return true;
      })
      .catch((error: unknown) => {
        this.failures++;
        const code = (error as NodeJS.ErrnoException)?.code;
        this.remember(
          entry,
          code === "EACCES" || code === "EPERM"
            ? "permission-denied"
            : code === "ENOSPC" || code === "EDQUOT"
              ? "no-space"
              : code === "EIO"
                ? "io-failed"
                : "storage-failed",
        );
        return false;
      })
      .finally(() => {
        this.pending--;
      });
    this.queue = task.then(() => {});
    return task;
  }
  private async prune() {
    const files = await this.files();
    let bytes = 0;
    for (const file of files.reverse()) {
      const path = join(this.directory, file),
        size = (await stat(path)).size;
      if (
        Number(file.slice(0, 13)) + 60_000 <
          this.now() - diagnosticRetentionMs ||
        bytes + size > this.maxBytes
      ) {
        await unlink(path);
        if (bytes + size > this.maxBytes) this.dropped++;
      } else bytes += size;
    }
  }
  async read() {
    await this.queue;
    this.pruneFallback();
    try {
      await this.prune();
    } catch {
      this.failures++;
      return [...this.fallback];
    }
    this.corruptRecords = 0;
    const entries: DiagnosticRecord[] = [...this.fallback];
    for (const file of await this.files()) {
      let content: string;
      try {
        content = await readFile(join(this.directory, file), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.failures++;
        continue;
      }
      for (const line of content.split("\n")) {
        if (!line) continue;
        try {
          const entry = safeDiagnosticRecord(JSON.parse(line));
          if (
            entry.at >= this.now() - diagnosticRetentionMs &&
            entry.at <= this.now() + 5 * 60_000
          )
            entries.push(entry);
        } catch {
          this.corruptRecords++;
          /* An interrupted final append must not discard earlier good samples. */
        }
      }
    }
    return [
      ...new Map(
        entries.map((entry) => [`${entry.session}:${entry.sequence}`, entry]),
      ).values(),
    ].sort((a, b) => a.at - b.at || a.sequence - b.sequence);
  }
  async status(): Promise<DiagnosticHistoryStatus> {
    const entries = await this.read();
    let bytes = 0;
    try {
      for (const file of await this.files())
        bytes += (await stat(join(this.directory, file))).size;
    } catch {
      /* status still exposes the storage failure */
    }
    return {
      since: entries[0]?.at,
      until: entries.at(-1)?.at,
      records: entries.length,
      bytes,
      writeFailures: this.failures,
      corruptRecords: this.corruptRecords,
      dropped: this.dropped,
      retentionMs: diagnosticRetentionMs,
    };
  }
}
