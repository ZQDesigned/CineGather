import { gameConnectionInput } from "@cinegather/contracts";
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  Body,
} from "@nestjs/common";
import { z } from "zod";
import {
  gameSessionInput,
  gameSnapshotSchema,
  gameLookupInput,
  gameLookupSchema,
  gameDecisionInput,
  gameInviteInput,
  gameRenewInput,
  okSchema,
} from "@cinegather/contracts";
import { Endpoint, parse, type AuthRequest } from "../../core/http";
import * as game from "./game-link";
const invitation = z.strictObject({
  id: z.uuid(),
  expiresAt: z.iso.datetime({ offset: true }),
});

@Controller("api/v1/games")
export class GameLinkController {
  @Get()
  @Endpoint("gameSnapshot", gameSnapshotSchema)
  snapshot(@Req() req: AuthRequest) {
    return game.gameSnapshot(req.user);
  }

  @Post()
  @Endpoint("createGameSession", gameSnapshotSchema, gameSessionInput, [], 201)
  create(@Req() req: AuthRequest, @Body() body: unknown) {
    return game.createGameSession(req.user, parse(gameSessionInput, body));
  }

  @Post("lookup")
  @Endpoint("lookupGameSession", gameLookupSchema, gameLookupInput, [], 201)
  lookup(@Req() req: AuthRequest, @Body() body: unknown) {
    return game.lookupGameSession(req.user, parse(gameLookupInput, body).code);
  }

  @Post(":sessionId/ready")
  @Endpoint(
    "gameSessionReady",
    gameSnapshotSchema,
    undefined,
    ["sessionId"],
    201,
  )
  ready(@Req() req: AuthRequest, @Param("sessionId") id: string) {
    return game.setGameReady(req.user, id);
  }

  @Post(":sessionId/requests")
  @Endpoint("requestGameJoin", invitation, undefined, ["sessionId"], 201)
  request(@Req() req: AuthRequest, @Param("sessionId") id: string) {
    return game.requestGameJoin(req.user, id);
  }

  @Delete("requests/:requestId")
  @Endpoint("cancelGameRequest", okSchema, undefined, ["requestId"])
  cancel(@Req() req: AuthRequest, @Param("requestId") id: string) {
    return game.cancelGameRequest(req.user, id);
  }

  @Delete("invitations/:inviteId")
  @Endpoint("dismissGameInvite", okSchema, undefined, ["inviteId"])
  dismiss(@Req() req: AuthRequest, @Param("inviteId") id: string) {
    return game.dismissGameInvite(req.user, id);
  }

  @Post("requests/:requestId/decision")
  @Endpoint(
    "decideGameRequest",
    gameSnapshotSchema,
    gameDecisionInput,
    ["requestId"],
    201,
  )
  decide(
    @Req() req: AuthRequest,
    @Param("requestId") id: string,
    @Body() body: unknown,
  ) {
    return game.decideGameRequest(
      req.user,
      id,
      parse(gameDecisionInput, body).approve,
    );
  }

  @Post(":sessionId/invitations")
  @Endpoint("inviteGameFriend", invitation, gameInviteInput, ["sessionId"], 201)
  invite(
    @Req() req: AuthRequest,
    @Param("sessionId") id: string,
    @Body() body: unknown,
  ) {
    return game.inviteGameFriend(
      req.user,
      id,
      parse(gameInviteInput, body).userId,
    );
  }

  @Post("invitations/:inviteId/accept")
  @Endpoint(
    "acceptGameInvite",
    gameSnapshotSchema,
    undefined,
    ["inviteId"],
    201,
  )
  accept(@Req() req: AuthRequest, @Param("inviteId") id: string) {
    return game.acceptGameInvite(req.user, id);
  }

  @Post(":sessionId/renew")
  @Endpoint(
    "renewGameMembership",
    gameSnapshotSchema,
    gameRenewInput,
    ["sessionId"],
    201,
  )
  renew(
    @Req() req: AuthRequest,
    @Param("sessionId") id: string,
    @Body() body: unknown,
  ) {
    return game.renewGameMembership(
      req.user,
      id,
      parse(gameRenewInput, body).revision,
    );
  }

  @Post(":sessionId/leave")
  @Endpoint(
    "leaveGameSession",
    gameSnapshotSchema,
    undefined,
    ["sessionId"],
    201,
  )
  leave(@Req() req: AuthRequest, @Param("sessionId") id: string) {
    return game.leaveGameSession(req.user, id);
  }

  @Post(":sessionId/end")
  @Endpoint("endGameSession", gameSnapshotSchema, undefined, ["sessionId"], 201)
  end(@Req() req: AuthRequest, @Param("sessionId") id: string) {
    return game.leaveGameSession(req.user, id, true);
  }

  @Post(":sessionId/members/:memberId/connection")
  @Endpoint(
    "observeGameConnection",
    okSchema,
    gameConnectionInput,
    ["sessionId", "memberId"],
    201,
  )
  connection(
    @Req() req: AuthRequest,
    @Param("sessionId") id: string,
    @Param("memberId") member: string,
    @Body() body: unknown,
  ) {
    const input = parse(gameConnectionInput, body);
    return game.observeGameConnection(
      req.user,
      id,
      member,
      input.revision,
      input.route,
    );
  }

  @Delete(":sessionId/members/:memberId")
  @Endpoint("removeGameMember", okSchema, undefined, ["sessionId", "memberId"])
  remove(
    @Req() req: AuthRequest,
    @Param("sessionId") id: string,
    @Param("memberId") member: string,
  ) {
    return game.removeGameMember(req.user, id, member);
  }
}
