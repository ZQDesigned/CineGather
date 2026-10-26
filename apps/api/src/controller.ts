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
  HttpException,
  Inject,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiQuery,
  ApiHeader,
  ApiExcludeEndpoint,
} from "@nestjs/swagger";
import { z } from "zod";
import type { Response } from "express";
import * as c from "@cinegather/contracts";
import * as r from "./rooms";
import * as s from "./social";
import * as presence from "./presence";
import { revokeSession } from "./auth";
import {
  registerAccount,
  loginAccount,
  changeAccountPassword,
} from "./accounts";
import { db } from "./context";
import { media } from "./media";
import { Endpoint, parse, type AuthRequest } from "./http";
import { fail } from "./errors";
import { readRegistrationPolicy } from "./registration";
import type { UpdateEvents } from "./update-events";
import { Metrics } from "./metrics";
import { ServerDiagnostics } from "./server-diagnostics";
const serverDiagnostics = new ServerDiagnostics();

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

  @Get("me")
  @Endpoint("me", c.userSchema)
  me(@Req() req: AuthRequest) {
    return req.user;
  }
  @Post("presence/heartbeat")
  @Endpoint("heartbeatPresence", c.presenceSchema, undefined, [], 201)
  heartbeatPresence(@Req() req: AuthRequest) {
    return presence.heartbeatPresence(req.user.id, req.sessionId!);
  }
  @Get("presence")
  @Endpoint("getPresence", c.presenceSchema)
  getPresence(@Req() req: AuthRequest) {
    return presence.readPresence(req.user.id);
  }
  @Post("presence")
  @Endpoint("setPresence", c.presenceSchema, c.presenceSchema, [], 201)
  setPresence(@Req() req: AuthRequest, @Body() body: unknown) {
    return presence.setPresence(
      req.user.id,
      parse(c.presenceSchema, body).visibility,
    );
  }
  @Get("client-policy")
  @Endpoint("clientPolicy", c.clientPolicySchema)
  clientPolicy(@Req() req: AuthRequest) {
    return c.clientPolicySchema.parse(req.app.get("cinegather.clientPolicy"));
  }
  @Get("client-events")
  @ApiExcludeEndpoint()
  clientEvents(@Req() req: AuthRequest, @Res() res: Response) {
    (req.app.get("cinegather.updateEvents") as UpdateEvents).connect(
      req,
      res,
      () => c.clientPolicySchema.parse(req.app.get("cinegather.clientPolicy")),
    );
  }
  @Get("registration")
  @Endpoint("registrationPolicy", c.registrationPolicySchema)
  async registrationPolicy() {
    return { enabled: (await readRegistrationPolicy()).enabled };
  }
  @Post("accounts/register")
  @Endpoint("registerAccount", c.sessionSchema, c.registerInput, [], 201)
  register(@Req() req: AuthRequest, @Body() body: unknown) {
    return registerAccount(parse(c.registerInput, body), req.user);
  }
  @Post("accounts/login")
  @Endpoint("loginAccount", c.sessionSchema, c.loginInput, [], 201)
  login(@Req() req: AuthRequest, @Body() body: unknown) {
    return loginAccount(parse(c.loginInput, body), req.ip ?? "unknown");
  }
  @Post("accounts/password")
  @Endpoint("changeAccountPassword", c.sessionSchema, c.passwordInput, [], 201)
  password(@Req() req: AuthRequest, @Body() body: unknown) {
    return changeAccountPassword(req.user, parse(c.passwordInput, body));
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
  @Post("rooms/:roomId/settings")
  @Endpoint(
    "updateRoomSettings",
    c.roomSchema,
    c.roomSettingsInput,
    ["roomId"],
    201,
  )
  updateSettings(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return r.updateRoomSettings(
      req.user,
      roomId,
      parse(c.roomSettingsInput, body),
    );
  }
  @Post("rooms/:roomId/join")
  @Endpoint("joinRoom", c.joinSchema, c.joinInput, ["roomId"], 201)
  async join(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    try {
      return await r.joinRoom(
        req.user,
        roomId,
        parse(c.joinInput, body),
        req.ip,
      );
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() >= 500)
        this.metrics.tokenIssueFailed();
      throw error;
    }
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
  @Post("rooms/:roomId/share-lease/preempt")
  @Endpoint("preemptShare", c.leaseSchema, undefined, ["roomId"], 201)
  preemptShare(@Req() req: AuthRequest, @Param("roomId") roomId: string) {
    return r.acquireLease(req.user, roomId, true);
  }
  @Post("rooms/:roomId/members/:userId/owner")
  @Endpoint("transferOwner", c.roomSchema, undefined, ["roomId", "userId"], 201)
  transferOwner(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Param("userId") userId: string,
  ) {
    return r.transferOwner(req.user, roomId, userId);
  }
  @Delete("rooms/:roomId/members/:userId/share")
  @Endpoint("stopMemberShare", c.okSchema, undefined, ["roomId", "userId"])
  stopMemberShare(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Param("userId") userId: string,
  ) {
    return r.stopMemberShare(req.user, roomId, userId);
  }
  @Post("rooms/:roomId/members/:userId/permissions")
  @Endpoint(
    "updateMemberPermissions",
    c.roomSchema,
    c.memberPermissionsInput,
    ["roomId", "userId"],
    201,
  )
  updateMemberPermissions(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    return r.updateMemberPermissions(
      req.user,
      roomId,
      userId,
      parse(c.memberPermissionsInput, body),
    );
  }
  @Post("rooms/:roomId/members/:userId/microphone/mute")
  @Endpoint(
    "muteMember",
    c.okSchema,
    c.muteMicrophoneInput,
    ["roomId", "userId"],
    201,
  )
  muteMember(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    parse(c.muteMicrophoneInput, body);
    return r.muteMember(req.user, roomId, userId);
  }
  @Post("rooms/:roomId/members/:userId/accompaniment/stop")
  @Endpoint(
    "stopMemberAccompaniment",
    c.okSchema,
    c.stopAccompanimentInput,
    ["roomId", "userId"],
    201,
  )
  stopMemberAccompaniment(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    parse(c.stopAccompanimentInput, body);
    return r.stopMemberAccompaniment(req.user, roomId, userId);
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
  @Post("rooms/:roomId/share-lease/native")
  @Endpoint(
    "nativePublication",
    c.nativePublicationSchema,
    c.leaseInput,
    ["roomId"],
    201,
  )
  native(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return r.nativePublication(req.user, roomId, parse(c.leaseInput, body));
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
  @ApiQuery({
    name: "after",
    required: false,
    type: "string",
    description:
      "Forward replay after a message ID, or start for an empty baseline",
  })
  @Endpoint("getMessages", c.messagesSchema, undefined, ["roomId"])
  messages(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Query("cursor") cursor?: string,
    @Query("after") after?: string,
  ) {
    return r.getMessages(req.user, roomId, cursor, after);
  }
  @Get("friends/search")
  @ApiQuery({ name: "username", required: true, type: String })
  @Endpoint("searchFriend", c.friendSearchSchema)
  searchFriend(@Req() req: AuthRequest, @Query("username") username: unknown) {
    return s.searchFriend(req.user, parse(c.usernameInput, username));
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
  @Endpoint("diagnostics", c.diagnosticServerSchema)
  async diagnostics() {
    const active = await media.client.listRooms();
    return {
      ...this.metrics.snapshot(),
      activeRooms: active.length,
      ...(await serverDiagnostics.snapshot()),
    };
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
