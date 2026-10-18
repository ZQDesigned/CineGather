import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  HttpCode,
  Inject,
} from "@nestjs/common";
import { ApiBearerAuth, ApiQuery, ApiHeader } from "@nestjs/swagger";
import { z } from "zod";
import type { Response } from "express";
import * as c from "@cinegather/contracts";
import * as r from "./rooms";
import * as s from "./social";
import { createGuest, revokeSession } from "./auth";
import { db } from "./context";
import { media } from "./media";
import { Endpoint, parse, type AuthRequest } from "./http";
import { fail } from "./errors";
import { Metrics } from "./metrics";

@ApiBearerAuth()
@Controller("api/v1")
export class ApiController {
  constructor(@Inject(Metrics) private readonly metrics: Metrics) {}
  @Get("health")
  @Endpoint(
    "health",
    z.object({
      ok: z.literal(true),
      database: z.literal("up"),
      media: z.literal("up"),
      version: z.string(),
      runtime: z.string(),
    }),
  )
  async health() {
    await db.execute("SELECT 1");
    await media.client.listRooms();
    return {
      ok: true,
      database: "up",
      media: "up",
      version: "0.1.0",
      runtime:
        typeof Bun !== "undefined"
          ? `bun ${Bun.version}`
          : `node ${process.versions.node}`,
    };
  }

  @Post("guests")
  @Endpoint("createGuest", c.sessionSchema, c.guestInput, [], 201)
  guest(@Body() body: unknown) {
    return createGuest(parse(c.guestInput, body).displayName);
  }
  @Get("me")
  @Endpoint("me", c.userSchema)
  me(@Req() req: AuthRequest) {
    return req.user;
  }
  @Delete("session")
  @Endpoint("revokeSession", c.okSchema)
  async logout(@Req() req: AuthRequest) {
    await revokeSession(req.headers.authorization!);
    return { ok: true };
  }
  @Get("rooms")
  @Endpoint("listRooms", z.object({ items: z.array(c.roomSchema) }))
  rooms(@Req() req: AuthRequest) {
    return r.listRooms(req.user);
  }
  @Post("rooms")
  @ApiHeader({ name: "idempotency-key", required: false })
  @Endpoint("createRoom", c.roomSchema, c.roomInput, [], 201)
  create(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    return r.createRoom(req.user, parse(c.roomInput, body), key);
  }
  @Get("rooms/:roomId")
  @Endpoint("getRoom", c.roomSchema, undefined, ["roomId"])
  room(@Req() req: AuthRequest, @Param("roomId") roomId: string) {
    return r.getRoom(req.user, roomId);
  }
  @Post("rooms/:roomId/join")
  @Endpoint("joinRoom", c.joinSchema, c.joinInput, ["roomId"], 201)
  join(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return r.joinRoom(req.user, roomId, parse(c.joinInput, body).inviteToken);
  }
  @Post("rooms/:roomId/leave")
  @Endpoint("leaveRoom", c.okSchema, undefined, ["roomId"], 201)
  leave(@Req() req: AuthRequest, @Param("roomId") roomId: string) {
    return r.leaveRoom(req.user, roomId);
  }
  @Post("rooms/:roomId/invites")
  @Endpoint("createInvite", c.inviteSchema, c.inviteInput, ["roomId"], 201)
  invite(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return r.createInvite(req.user, roomId, parse(c.inviteInput, body));
  }
  @Delete("rooms/:roomId/invites/:inviteId")
  @Endpoint("revokeInvite", c.okSchema, undefined, ["roomId", "inviteId"])
  revokeInvite(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Param("inviteId") inviteId: string,
  ) {
    return r.revokeInvite(req.user, roomId, inviteId);
  }
  @Post("rooms/:roomId/share-lease")
  @Endpoint("acquireLease", c.leaseSchema, undefined, ["roomId"], 201)
  lease(@Req() req: AuthRequest, @Param("roomId") roomId: string) {
    return r.acquireLease(req.user, roomId);
  }
  @Post("rooms/:roomId/share-lease/renew")
  @Endpoint("renewLease", c.leaseSchema, c.leaseInput, ["roomId"], 201)
  renew(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return r.renewLease(req.user, roomId, parse(c.leaseInput, body));
  }
  @Delete("rooms/:roomId/share-lease")
  @Endpoint("releaseLease", c.okSchema, c.leaseInput, ["roomId"])
  release(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return r.releaseLease(req.user, roomId, parse(c.leaseInput, body));
  }
  @Delete("rooms/:roomId/members/:userId")
  @Endpoint("moderate", c.okSchema, c.moderationInput, ["roomId", "userId"])
  moderate(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    return r.moderate(
      req.user,
      roomId,
      userId,
      parse(c.moderationInput, body).ban,
    );
  }
  @Get("rooms/:roomId/bans")
  @Endpoint(
    "listBans",
    z.object({
      items: z.array(z.object({ userId: z.uuid(), displayName: z.string() })),
    }),
    undefined,
    ["roomId"],
  )
  bans(@Req() req: AuthRequest, @Param("roomId") roomId: string) {
    return r.listBans(req.user, roomId);
  }
  @Delete("rooms/:roomId/bans/:userId")
  @Endpoint("unban", c.okSchema, undefined, ["roomId", "userId"])
  unban(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Param("userId") userId: string,
  ) {
    return r.unban(req.user, roomId, userId);
  }
  @Post("rooms/:roomId/messages")
  @ApiHeader({ name: "idempotency-key", required: false })
  @Endpoint("postMessage", c.messageSchema, c.messageInput, ["roomId"], 201)
  message(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    return r.postMessage(
      req.user,
      roomId,
      parse(c.messageInput, body).body,
      key,
    );
  }
  @Get("rooms/:roomId/messages")
  @ApiQuery({ name: "cursor", required: false, type: "string" })
  @Endpoint("getMessages", c.messagesSchema, undefined, ["roomId"])
  messages(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Query("cursor") cursor?: string,
  ) {
    return r.getMessages(req.user, roomId, cursor);
  }
  @Get("friends")
  @Endpoint("listFriends", c.friendsSchema)
  friends(@Req() req: AuthRequest) {
    return s.listFriends(req.user);
  }
  @Post("friends")
  @Endpoint("requestFriend", c.okSchema, c.friendInput, [], 201)
  friend(@Req() req: AuthRequest, @Body() body: unknown) {
    return s.requestFriend(req.user, parse(c.friendInput, body).userId);
  }
  @Post("friends/:userId/accept")
  @Endpoint("acceptFriend", c.okSchema, undefined, ["userId"], 201)
  accept(@Req() req: AuthRequest, @Param("userId") userId: string) {
    return s.acceptFriend(req.user, userId);
  }
  @Delete("friends/:userId")
  @Endpoint("removeFriend", c.okSchema, undefined, ["userId"])
  remove(@Req() req: AuthRequest, @Param("userId") userId: string) {
    return s.removeFriend(req.user, userId);
  }
  @Get("diagnostics")
  @Endpoint(
    "diagnostics",
    z.object({
      uptimeSeconds: z.number(),
      requests: z.number(),
      errors: z.number(),
      authDenied: z.number(),
      averageDurationMs: z.number(),
      activeRooms: z.number(),
    }),
  )
  async diagnostics() {
    const active = await media.client.listRooms();
    return { ...this.metrics.snapshot(), activeRooms: active.length };
  }
  @Post("livekit/webhook")
  @HttpCode(200)
  async webhook(
    @Req() req: AuthRequest & { rawBody?: Buffer },
    @Res() res: Response,
  ) {
    if (!req.rawBody) fail(400, "INVALID_WEBHOOK", "缺少原始请求体");
    let event;
    try {
      event = await media.webhooks.receive(
        req.rawBody.toString(),
        req.headers.authorization,
      );
    } catch {
      fail(401, "INVALID_WEBHOOK_SIGNATURE", "事件签名无效");
    }
    if (event.room?.name) await r.reconcileRoom(event.room.name);
    res.json({ ok: true });
  }
}
