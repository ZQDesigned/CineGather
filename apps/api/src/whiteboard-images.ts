import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  whiteboardImages,
  whiteboardSnapshots,
  whiteboardRecords,
  roomSessions,
} from "@cinegather/database";
import type { User } from "@cinegather/contracts";
import { db } from "./context";
import { fail, uuid } from "./errors";
import { readActivity, roomActivityAccess } from "./activity-storage";
import { sessionCredential } from "./session-context";
import { requireFeature } from "./feature-policy";
function pngCrc(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Clients normalize uploads to static PNG. Limit decoded pixels, compressed bytes
// and inflated bytes independently. No SVG, external URLs or animated payloads.
export function validateBoardPng(data: string) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data))
    throw Error("请选择 PNG 图片");
  const bytes = Buffer.from(data.slice(22), "base64");
  if (
    bytes.length > 2_000_000 ||
    bytes.length < 45 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw Error("图片格式或大小不符合要求");
  let offset = 8,
    width = 0,
    height = 0,
    ended = false;
  const chunks: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset),
      end = offset + 12 + length;
    if (end > bytes.length) throw Error("图片文件不完整");
    if (
      pngCrc(bytes.subarray(offset + 4, end - 4)) !==
      bytes.readUInt32BE(end - 4)
    )
      throw Error("图片校验失败");
    const kind = bytes.toString("ascii", offset + 4, offset + 8),
      body = bytes.subarray(offset + 8, offset + 8 + length);
    if (offset === 8 && kind !== "IHDR") throw Error("图片头不正确");
    if (kind === "IHDR") {
      if (width || length !== 13) throw Error("图片头不正确");
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (
        !width ||
        !height ||
        width > 4096 ||
        height > 4096 ||
        width * height > 4_000_000 ||
        body[8] !== 8 ||
        ![2, 6].includes(body[9]!) ||
        body[10] !== 0 ||
        body[11] !== 0 ||
        body[12] !== 0
      )
        throw Error("图片尺寸或编码不支持");
    } else if (kind === "IDAT") chunks.push(body);
    else if (kind === "acTL") throw Error("请使用静态图片");
    else if (kind === "IEND") {
      if (length) throw Error("图片结束标记不正确");
      ended = true;
      offset = end;
      break;
    }
    offset = end;
  }
  if (!ended || offset !== bytes.length || !chunks.length)
    throw Error("图片文件不完整");
  const rgba = bytes[25] === 6,
    expected = (width * (rgba ? 4 : 3) + 1) * height;
  const raw = inflateSync(Buffer.concat(chunks), {
    maxOutputLength: expected + 1,
  });
  if (raw.length !== expected) throw Error("图片像素数据不完整");
  for (let row = 0; row < height; row++)
    if (raw[row * (width * (rgba ? 4 : 3) + 1)]! > 4)
      throw Error("图片像素编码不支持");
  return { width, height };
}
export async function uploadWhiteboardImage(
  user: User,
  roomId: string,
  input: { generation: number; data: string },
) {
  requireFeature(user, "room.activities");
  roomId = uuid(roomId);
  return db.transaction(async (tx) => {
    const { room } = await roomActivityAccess(tx, user, roomId);
    const { state } = await readActivity(tx, room);
    if (
      state.kind !== "board" ||
      state.generation !== input.generation ||
      state.starterId !== user.id
    )
      fail(403, "WHITEBOARD_UPLOAD_FORBIDDEN", "仅当前白板发起人可以加入图片");
    const counts = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(whiteboardImages)
      .where(eq(whiteboardImages.activityId, state.id));
    if ((counts[0]?.count ?? 0) >= 10)
      fail(409, "WHITEBOARD_IMAGE_LIMIT", "每张白板最多加入 10 张图片");
    let size: { width: number; height: number };
    try {
      size = validateBoardPng(input.data);
    } catch (e) {
      fail(400, "INVALID_WHITEBOARD_IMAGE", (e as Error).message);
    }
    const id = randomUUID();
    await tx
      .insert(whiteboardImages)
      .values({ id, roomId, activityId: state.id, data: input.data });
    return { id, ...size };
  });
}
export async function readWhiteboardImage(user: User, id: string) {
  id = uuid(id);
  return db.transaction(async (tx) => {
    const [image] = await tx
      .select()
      .from(whiteboardImages)
      .where(eq(whiteboardImages.id, id));
    if (!image) fail(404, "WHITEBOARD_IMAGE_NOT_FOUND", "图片不存在");
    const records = await tx
      .select({ document: whiteboardSnapshots.document })
      .from(whiteboardRecords)
      .innerJoin(
        whiteboardSnapshots,
        eq(whiteboardRecords.snapshotId, whiteboardSnapshots.id),
      )
      .where(
        and(
          eq(whiteboardRecords.userId, user.id),
          sql`${whiteboardSnapshots.document}->'elements' @> ${JSON.stringify([{ imageId: id }])}::jsonb`,
        ),
      )
      .limit(1);
    if (records.length) return { data: image.data };
    // Lock only the caller's admitted room. Re-read after the lock so a concurrent
    // switch cannot grant access using an obsolete board snapshot.
    const credentialId = sessionCredential(user);
    const [session] = credentialId
      ? await tx
          .select()
          .from(roomSessions)
          .where(
            and(
              eq(roomSessions.credentialId, credentialId),
              gt(roomSessions.admittedUntil, new Date()),
            ),
          )
          .limit(1)
      : [];
    if (session) {
      try {
        const { room } = await roomActivityAccess(tx, user, session.roomId);
        const { state } = await readActivity(tx, room);
        if (
          state.kind === "board" &&
          (state.board.elements.some((e) => e.imageId === id) ||
            (state.id === image.activityId && state.starterId === user.id))
        )
          return { data: image.data };
      } catch {
        /* Image reads intentionally do not reveal room admission details. */
      }
    }
    fail(404, "WHITEBOARD_IMAGE_NOT_FOUND", "图片不存在或无权访问");
  });
}
