import * as c from "@cinegather/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Endpoint, parse, type AuthRequest } from "../../core/http";
import { Metrics } from "../../core/metrics";
import {
  dismissRoomInvitation,
  inviteFriendToRoom,
} from "../social/friend-room-invitations";
import * as r from "./rooms";
import * as queue from "./share-requests";

@ApiBearerAuth()
@ApiTags("Api")
@Controller("api/v1")
export class RoomsController {
  constructor(@Inject(Metrics) private readonly metrics: Metrics) {}

  @Post("rooms/:roomId/join-admission")
  @Endpoint("joinAdmission", c.okSchema, undefined, ["roomId"], 201)
  joinAdmission(@Req() req: AuthRequest, @Param("roomId") id: string) {
    return r.joinAdmission(req.user, id);
  }

  @Post("rooms/:roomId/watch-admission")
  @Endpoint("watchAdmission", c.okSchema, undefined, ["roomId"], 201)
  watchAdmission(@Req() req: AuthRequest, @Param("roomId") id: string) {
    return r.watchAdmission(req.user, id);
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

  @Get("rooms/:roomId/share-requests")
  @Endpoint("listShareRequests", c.shareRequestsSchema, undefined, ["roomId"])
  shareQueue(@Req() req: AuthRequest, @Param("roomId") id: string) {
    return queue.readQueue(req.user, id);
  }

  @Post("rooms/:roomId/share-requests")
  @Endpoint("requestShareHandoff", c.okSchema, undefined, ["roomId"], 201)
  requestShare(@Req() req: AuthRequest, @Param("roomId") id: string) {
    return queue.requestShare(req.user, id);
  }

  @Delete("rooms/:roomId/share-requests")
  @Endpoint("cancelShareHandoff", c.okSchema, undefined, ["roomId"])
  cancelShare(@Req() req: AuthRequest, @Param("roomId") id: string) {
    return queue.cancelShareRequest(req.user, id);
  }

  @Post("rooms/:roomId/share-requests/:requestId/approve")
  @Endpoint(
    "approveShareHandoff",
    c.okSchema,
    undefined,
    ["roomId", "requestId"],
    201,
  )
  approveShare(
    @Req() req: AuthRequest,
    @Param("roomId") id: string,
    @Param("requestId") rid: string,
  ) {
    return queue.decideShareRequest(req.user, id, rid, true);
  }

  @Post("rooms/:roomId/share-requests/:requestId/reject")
  @Endpoint(
    "rejectShareHandoff",
    c.okSchema,
    undefined,
    ["roomId", "requestId"],
    201,
  )
  rejectShare(
    @Req() req: AuthRequest,
    @Param("roomId") id: string,
    @Param("requestId") rid: string,
  ) {
    return queue.decideShareRequest(req.user, id, rid, false);
  }

  @Post("rooms/:roomId/share-requests/:requestId/acquire")
  @Endpoint(
    "acceptShareHandoff",
    c.leaseSchema,
    c.shareQualityInput,
    ["roomId", "requestId"],
    201,
  )
  acceptShare(
    @Req() req: AuthRequest,
    @Param("roomId") id: string,
    @Param("requestId") rid: string,
    @Body() body: unknown,
  ) {
    return r.acquireLease(
      req.user,
      id,
      false,
      rid,
      parse(c.shareQualityInput, body ?? {}).quality,
    );
  }

  @Post("rooms/:roomId/share-lease")
  @Endpoint("acquireLease", c.leaseSchema, c.shareQualityInput, ["roomId"], 201)
  lease(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return r.acquireLease(
      req.user,
      roomId,
      false,
      undefined,
      parse(c.shareQualityInput, body ?? {}).quality,
    );
  }

  @Post("rooms/:roomId/share-lease/preempt")
  @Endpoint("preemptShare", c.leaseSchema, c.shareQualityInput, ["roomId"], 201)
  preemptShare(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return r.acquireLease(
      req.user,
      roomId,
      true,
      undefined,
      parse(c.shareQualityInput, body ?? {}).quality,
    );
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
    c.nativeShareInput,
    ["roomId"],
    201,
  )
  native(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return r.nativePublication(
      req.user,
      roomId,
      parse(c.nativeShareInput, body),
    );
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

  @Post("rooms/:roomId/bans")
  @Endpoint("banByUsername", c.okSchema, c.roomBanInput, ["roomId"], 201)
  banByUsername(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return r.banByUsername(
      req.user,
      roomId,
      parse(c.roomBanInput, body).username,
    );
  }

  @Get("rooms/:roomId/bans")
  @Endpoint(
    "listBans",
    z.object({
      items: z.array(
        z.object({
          userId: z.uuid(),
          displayName: z.string(),
          username: z.string().nullable().optional(),
        }),
      ),
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

  @Post("rooms/:roomId/friend-invitations")
  @Endpoint(
    "inviteFriendToRoom",
    c.friendRoomInviteSentSchema,
    c.esportsFriendInviteInput,
    ["roomId"],
    201,
  )
  inviteFriendToRoom(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    const input = parse(c.esportsFriendInviteInput, body);
    return inviteFriendToRoom(req.user, roomId, input.userId, input.seat);
  }

  @Delete("room-invitations/:inviteId")
  @Endpoint("dismissRoomInvitation", c.okSchema, undefined, ["inviteId"])
  dismissRoomInvitation(
    @Req() req: AuthRequest,
    @Param("inviteId") inviteId: string,
  ) {
    return dismissRoomInvitation(req.user, inviteId);
  }
}
