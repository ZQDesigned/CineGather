import { randomBytes } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { WebSocketServer, WebSocket } from "ws";
import type { Server, IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  activityCommandSchema,
  type ActivitySnapshot,
  type User,
} from "@cinegather/contracts";
import {
  activityCommand,
  activityEvents,
  activitySnapshot,
} from "./room-activities";
import { config } from "./config";
import { sessionCredential } from "./session-context";

const tickets = new Map<
  string,
  { user: User; roomId: string; expiresAt: number }
>();
export function issueActivityTicket(user: User, roomId: string) {
  for (const [key, value] of tickets)
    if (value.expiresAt < Date.now()) tickets.delete(key);
  if (tickets.size >= 5000)
    throw new HttpException(
      { code: "ACTIVITY_BUSY", message: "连接繁忙，请稍后再试" },
      503,
    );
  const ticket = randomBytes(32).toString("base64url");
  tickets.set(ticket, { user, roomId, expiresAt: Date.now() + 10000 });
  return { ticket };
}
export function attachActivityGateway(
  server: Server,
  maintenance: () => boolean,
) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 65536,
    perMessageDeflate: false,
  });
  const sessions = new Map<string, WebSocket>();
  const upgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (req.url?.split("?")[0] !== "/api/v1/room-activities/ws") return;
    const origin = req.headers.origin;
    if (
      maintenance() ||
      (origin &&
        !config.corsOrigins.includes(origin) &&
        origin !== "app://cinegather")
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  };
  server.on("upgrade", upgrade);
  wss.on("connection", (ws) => {
    let identity: ReturnType<typeof tickets.get>,
      previous: ActivitySnapshot | undefined,
      busy = false,
      dirty = false,
      closed = false;
    let windowAt = Date.now(),
      count = 0,
      queued = 0,
      chain = Promise.resolve();
    const completed = new Map<string, unknown>();
    const authTimeout = setTimeout(
      () => ws.close(1008, "Authentication required"),
      10000,
    );
    authTimeout.unref();
    const send = (value: unknown) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > 2_000_000) {
        ws.close(1013, "Slow connection");
        return;
      }
      ws.send(JSON.stringify(value));
    };
    const refresh = async () => {
      if (!identity || closed) return;
      if (busy) {
        dirty = true;
        return;
      }
      busy = true;
      try {
        if (maintenance()) {
          ws.close(1012, "Maintenance");
          return;
        }
        const next = await activitySnapshot(identity.user, identity.roomId);
        if (closed) return;
        if (!previous || previous.generation !== next.generation) {
          send({ type: "snapshot", snapshot: next });
        } else if (
          previous.revision !== next.revision ||
          previous.ownerId !== next.ownerId ||
          previous.game?.clue !== next.game?.clue
        ) {
          const old = new Map(
              previous.board?.elements.map((e) => [e.id, e]) ?? [],
            ),
            current = new Map(next.board?.elements.map((e) => [e.id, e]) ?? []);
          send({
            type: "patch",
            baseRevision: previous.revision,
            snapshot: { ...next, board: undefined },
            board: next.board
              ? {
                  ...next.board,
                  elements: undefined,
                  put: next.board.elements.filter(
                    (e) => JSON.stringify(old.get(e.id)) !== JSON.stringify(e),
                  ),
                  remove: [...old.keys()].filter((id) => !current.has(id)),
                }
              : undefined,
          });
        }
        previous = next;
      } catch {
        ws.close(1008, "Room admission expired");
      } finally {
        busy = false;
        if (dirty && !closed) {
          dirty = false;
          void refresh();
        }
      }
    };
    const interval = setInterval(() => void refresh(), 3000);
    interval.unref();
    ws.on("message", (raw, binary) => {
      if (binary) {
        ws.close(1003);
        return;
      }
      if (Date.now() - windowAt >= 1000) {
        windowAt = Date.now();
        count = 0;
      }
      if (++count > 12) {
        ws.close(1008, "Rate limit");
        return;
      }
      let input: { ticket?: string; id?: string; command?: unknown };
      try {
        input = JSON.parse(raw.toString());
      } catch {
        ws.close(1007);
        return;
      }
      if (!identity) {
        const entry =
          typeof input.ticket === "string"
            ? tickets.get(input.ticket)
            : undefined;
        if (input.ticket) tickets.delete(input.ticket);
        if (!entry || entry.expiresAt < Date.now()) {
          ws.close(1008, "Ticket expired");
          return;
        }
        identity = entry;
        clearTimeout(authTimeout);
        const session = sessionCredential(entry.user)!;
        sessions.get(session)?.close(1000, "Reconnected");
        sessions.set(session, ws);
        activityEvents.on(entry.roomId, refresh);
        void refresh();
        return;
      }
      const parsed = activityCommandSchema.safeParse(input.command);
      if (
        !parsed.success ||
        !input.id ||
        !/^[a-zA-Z0-9-]{8,64}$/.test(input.id)
      ) {
        send({
          type: "error",
          id: input.id,
          code: "INVALID_INPUT",
          message: "操作格式不正确",
        });
        return;
      }
      const actor = identity,
        id = input.id;
      if (completed.has(id)) {
        send(completed.get(id));
        return;
      }
      if (++queued > 8) {
        ws.close(1013, "Command queue full");
        return;
      }
      chain = chain.then(async () => {
        queued--;
        if (completed.has(id)) {
          send(completed.get(id));
          return;
        }
        if (closed) return;
        try {
          if (maintenance())
            throw new HttpException(
              { code: "MAINTENANCE", message: "服务器正在维护" },
              503,
            );
          await activityCommand(actor.user, actor.roomId, parsed.data);
          const ack = { type: "ack", id };
          completed.set(id, ack);
          if (completed.size > 256)
            completed.delete(completed.keys().next().value!);
          send(ack);
        } catch (e) {
          const body = e instanceof HttpException ? e.getResponse() : {};
          const detail =
            typeof body === "object"
              ? (body as { code?: string; message?: string })
              : {};
          send({
            type: "error",
            id,
            code: detail.code ?? "ACTIVITY_FAILED",
            message: detail.message ?? "暂时无法同步活动，请重试",
          });
        }
      });
    });
    ws.on("error", () => ws.close());
    ws.once("close", () => {
      closed = true;
      clearTimeout(authTimeout);
      clearInterval(interval);
      if (identity) {
        activityEvents.off(identity.roomId, refresh);
        const key = sessionCredential(identity.user)!;
        if (sessions.get(key) === ws) sessions.delete(key);
      }
    });
  });
  return {
    close() {
      server.off("upgrade", upgrade);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      tickets.clear();
    },
  };
}
