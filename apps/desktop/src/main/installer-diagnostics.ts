import type { Stats } from "node:fs";
import { readdir, lstat, readFile } from "node:fs/promises";
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
const journalIssues = new Map<string, number>();
const remember = (code: string) =>
  journalIssues.set(code, (journalIssues.get(code) ?? 0) + 1);
const maxFile = 1024 * 1024,
  maxTotal = 32 * maxFile;
const owned =
  /^(?:app-[\da-f-]+\.jsonl|nsis-\d+-\d+\.tsv|snapshot-[\w-]+\.json|process-cleanup(?:\.previous)?\.jsonl)$/i;
const text = z.string().max(4096),
  integer = z.number().int().finite();
const processInfo = z.object({
  pid: integer,
  ppid: integer.optional(),
  name: text.optional(),
  path: text.optional(),
  started: text.optional(),
  session: integer.optional(),
});
const record = z.object({
  v: z.literal(1),
  at: integer,
  phase: z.string().max(100),
  pid: integer.optional(),
  attempt: z.string().max(80).optional(),
  version: z.string().max(50).optional(),
  targetVersion: z.string().max(50).optional(),
  path: text.optional(),
  detail: text.optional(),
  code: z.union([integer, z.string().max(100)]).optional(),
  win32Code: integer.optional(),
  scope: z.string().max(100).optional(),
  complete: z.boolean().optional(),
  processes: z.array(processInfo).max(256).optional(),
  files: z
    .array(
      z.object({
        path: text,
        size: z.number().finite().optional(),
        code: integer.optional(),
        owners: z.array(processInfo).max(32).optional(),
        queryCode: integer.optional(),
      }),
    )
    .max(256)
    .optional(),
  registry: z
    .array(
      z.object({ hive: text, version: text.optional(), path: text.optional() }),
    )
    .max(16)
    .optional(),
  volumes: z
    .array(
      z.object({
        drive: text,
        filesystem: text.optional(),
        free: z.number().finite().optional(),
      }),
    )
    .max(32)
    .optional(),
  access: z
    .array(z.object({ path: text, owner: text, sddl: text }))
    .max(8)
    .optional(),
  environment: z
    .object({
      temp: text,
      osVersion: text,
      elevated: z.boolean(),
      userSid: text,
    })
    .optional(),
  issues: z
    .array(z.object({ stage: text, code: z.union([integer, text]).optional() }))
    .max(100)
    .optional(),
});
export interface InstallerEvidence {
  available: boolean;
  records: unknown[];
  issues: string[];
}
function sanitize(value: unknown): unknown {
  if (typeof value === "string") {
    let clean = value;
    const profiles = [
      process.env.LOCALAPPDATA,
      process.env.APPDATA,
      process.env.USERPROFILE,
    ]
      .filter((p): p is string => Boolean(p && p.length > 4))
      .sort((a, b) => b.length - a.length);
    for (const profile of profiles)
      clean = clean.split(profile).join("<USER_DIRECTORY>");
    return clean
      .replace(/([a-z]:\\Users\\)[^\\]+/gi, "$1<USER>")
      .replace(/https?:\/\/[^\s"<>]+/gi, "<URL>")
      .replace(
        /(?:Bearer\s+|(?:token|password|secret)=)[^\s,;]+/gi,
        "<REDACTED>",
      );
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, sanitize(v)]),
    );
  return value;
}
export function installerDiagnosticDirectory() {
  return process.platform === "win32" && process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "CineGather", "installer-logs")
    : undefined;
}
export class InstallerJournal {
  readonly attempt = randomUUID();
  failures = 0;
  constructor(
    private directory: string | undefined,
    private version: string,
    private now = Date.now,
  ) {}
  record(phase: string, values: Record<string, unknown> = {}) {
    if (!this.directory) return;
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const path = join(this.directory, `app-${this.attempt}.jsonl`);
      if ((existsSize(path) ?? 0) >= maxFile) {
        this.failures++;
        remember("journal-size-limit");
        return;
      }
      const value = record.parse({
        ...values,
        v: 1,
        at: this.now(),
        phase,
        pid: process.pid,
        attempt: this.attempt,
        version: this.version,
      });
      appendFileSync(path, JSON.stringify(sanitize(value)) + "\n", {
        mode: 0o600,
      });
      const files = readdirSync(this.directory)
        .filter((n) => owned.test(n))
        .map((name) => ({ name, stat: lstatSync(join(this.directory!, name)) }))
        .filter((f) => f.stat.isFile())
        .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
      let bytes = 0,
        count = 0;
      for (const f of files) {
        bytes += f.stat.size;
        count++;
        if (f.name === `app-${this.attempt}.jsonl`) continue;
        if (
          count > 64 ||
          bytes > maxTotal ||
          f.stat.mtimeMs < this.now() - 30 * 86400000
        )
          unlinkSync(join(this.directory, f.name));
      }
    } catch (error) {
      this.failures++;
      const code = (error as NodeJS.ErrnoException).code;
      remember(
        ["EACCES", "EPERM", "ENOSPC", "EIO", "ENOTDIR"].includes(code ?? "")
          ? code!
          : "journal-write-failed",
      );
    }
  }
}
function existsSize(path: string) {
  try {
    return lstatSync(path).size;
  } catch {
    return undefined;
  }
}
export async function readInstallerDiagnostics(
  directory?: string,
): Promise<InstallerEvidence> {
  const result: InstallerEvidence = {
    available: false,
    records: [],
    issues: [...journalIssues].map(
      ([code, count]) => "application-journal:" + code + ":" + count,
    ),
  };
  if (!directory) return result;
  try {
    const files: { name: string; stat: Stats }[] = [];
    for (const name of (await readdir(directory)).filter((n) =>
      owned.test(n),
    )) {
      try {
        const stat = await lstat(join(directory, name));
        if (stat.isFile()) files.push({ name, stat });
      } catch {
        result.issues.push(name + ":metadata-unavailable");
      }
    }
    files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs);
    result.available = true;
    let bytes = 0;
    for (const f of files) {
      if (
        f.stat.size > maxFile ||
        (bytes += f.stat.size) > maxTotal ||
        result.records.length >= 10000
      ) {
        result.issues.push(f.name + ":size-or-count-limit");
        continue;
      }
      try {
        const buffer = await readFile(join(directory, f.name));
        const lines = f.name.endsWith(".tsv")
          ? buffer
              .toString("utf16le")
              .replace(/^\uFEFF/, "")
              .split(/\r?\n/)
          : f.name.endsWith(".jsonl")
            ? buffer
                .toString("utf8")
                .replace(/^\uFEFF/, "")
                .split(/\r?\n/)
            : [buffer.toString("utf8").replace(/^\uFEFF/, "")];
        for (const line of lines.filter((s) => s.trim())) {
          if (result.records.length >= 10000) {
            result.issues.push(f.name + ":count-limit");
            break;
          }
          try {
            let value: unknown;
            if (f.name.endsWith(".tsv")) {
              const [
                format,
                ticks,
                pid,
                attempt,
                version,
                phase,
                path,
                code,
                win32,
              ] = line.split("\t");
              if (format !== "v1" || !ticks || !phase)
                throw Error("invalid-row");
              value = {
                v: 1,
                at: Number((BigInt(ticks) - 116444736000000000n) / 10000n),
                pid: Number(pid),
                attempt,
                version,
                phase,
                path,
                code: code ? Number(code) : undefined,
                win32Code: win32 ? Number(win32) : undefined,
              };
            } else {
              const raw = JSON.parse(line);
              value = f.name.startsWith("process-cleanup")
                ? {
                    ...raw,
                    v: 1,
                    at: Date.parse(raw.time),
                    phase: raw.action,
                    path: raw.root,
                    detail: raw.image,
                  }
                : raw;
            }
            result.records.push({
              ...(sanitize(record.parse(value)) as object),
              sourceFile: f.name,
            });
          } catch {
            result.issues.push(f.name + ":invalid-or-torn-record");
          }
        }
      } catch {
        result.issues.push(f.name + ":read-failed");
      }
    }
  } catch (error) {
    result.issues.push((error as NodeJS.ErrnoException).code ?? "read-failed");
  }
  result.issues = [...new Set(result.issues)].slice(0, 100);
  result.records.sort(
    (a, b) => (a as { at: number }).at - (b as { at: number }).at,
  );
  return result;
}
