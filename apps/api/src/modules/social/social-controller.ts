import * as c from "@cinegather/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiQuery, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { Endpoint, parse, type AuthRequest } from "../../core/http";
import { requestFriendGame } from "../games/game-link";
import { decideRoomRequest, requestFriendRoom } from "./friend-room-requests";
import * as presence from "./presence";
import * as s from "./social";

@ApiBearerAuth()
@ApiTags("Api")
@Controller("api/v1")
export class SocialController {
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

  @Get("friends/search")
  @ApiQuery({ name: "username", required: true, type: String })
  @Endpoint("searchFriend", c.friendSearchSchema)
  searchFriend(@Req() req: AuthRequest, @Query("username") username: unknown) {
    return s.searchFriend(req.user, parse(c.usernameInput, username));
  }

  @Post("friends/:userId/game-requests")
  @Endpoint(
    "requestFriendGame",
    z.strictObject({
      id: z.uuid(),
      expiresAt: z.iso.datetime({ offset: true }),
    }),
    undefined,
    ["userId"],
    201,
  )
  requestFriendGame(@Req() req: AuthRequest, @Param("userId") userId: string) {
    return requestFriendGame(req.user, userId);
  }

  @Post("friends/:userId/room-requests")
  @Endpoint(
    "requestFriendRoom",
    c.friendRoomInviteSentSchema,
    undefined,
    ["userId"],
    201,
  )
  requestFriendRoom(@Req() req: AuthRequest, @Param("userId") userId: string) {
    return requestFriendRoom(req.user, userId);
  }

  @Post("room-requests/:requestId/approve")
  @Endpoint("approveRoomRequest", c.okSchema, undefined, ["requestId"], 201)
  approveRoomRequest(
    @Req() req: AuthRequest,
    @Param("requestId") requestId: string,
  ) {
    return decideRoomRequest(req.user, requestId, true);
  }

  @Post("room-requests/:requestId/reject")
  @Endpoint("rejectRoomRequest", c.okSchema, undefined, ["requestId"], 201)
  rejectRoomRequest(
    @Req() req: AuthRequest,
    @Param("requestId") requestId: string,
  ) {
    return decideRoomRequest(req.user, requestId, false);
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

  @Patch("friends/:userId/preferences")
  @Endpoint("updateFriendPreferences", c.okSchema, c.friendPreferencesInput, [
    "userId",
  ])
  preferences(
    @Req() req: AuthRequest,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    return s.updateFriendPreferences(
      req.user,
      userId,
      parse(c.friendPreferencesInput, body),
    );
  }
}
