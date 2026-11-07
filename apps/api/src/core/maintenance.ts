import { openSync, readSync, closeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const defaultMessage = "服务器正在维护，请稍后重试。";
const maxBytes = 4096;

// Presence is the switch: operators atomically replace this small file to enable
// maintenance and remove it to resume, without restarting the API. A malformed
// or unreadable file must keep writes blocked rather than silently reopen them.
export function readMaintenance(file: string) {
  let fd: number;
  try {
    fd = openSync(file, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    return { code: "SERVER_MAINTENANCE", message: defaultMessage };
  }
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const size = readSync(fd, buffer, 0, buffer.length, 0);
    if (size > maxBytes) throw Error("Maintenance notice too large");
    const value: unknown = JSON.parse(buffer.subarray(0, size).toString());
    const notice = value && typeof value === "object" ? value : {};
    const message =
      "message" in notice &&
      typeof notice.message === "string" &&
      notice.message.trim() &&
      notice.message.length <= 500
        ? notice.message.trim()
        : defaultMessage;
    const expectedResumeAt =
      "expectedResumeAt" in notice &&
      typeof notice.expectedResumeAt === "string" &&
      Number.isFinite(Date.parse(notice.expectedResumeAt))
        ? new Date(notice.expectedResumeAt).toISOString()
        : undefined;
    return { code: "SERVER_MAINTENANCE", message, expectedResumeAt };
  } catch {
    return { code: "SERVER_MAINTENANCE", message: defaultMessage };
  } finally {
    closeSync(fd);
  }
}

export function maintenanceGate(file: string): RequestHandler {
  return (_req, res, next) => {
    const notice = readMaintenance(file);
    if (!notice) return next();
    const requestId = randomUUID();
    res
      .status(503)
      .set({
        "X-Request-Id": requestId,
        "X-CineGather-Maintenance": "1",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Retry-After": "60",
      })
      .json({ ...notice, requestId });
  };
}
