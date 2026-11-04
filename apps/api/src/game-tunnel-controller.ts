import { Controller, Get, Param, Req } from "@nestjs/common";
import { gameTunnelConfigSchema } from "@cinegather/contracts";
import { Endpoint, type AuthRequest } from "./http";
import { issueGameTransport } from "./game-tunnel-auth";
@Controller("api/v1/games")
export class GameTunnelController {
  @Get(":sessionId/transport")
  @Endpoint("gameTransport", gameTunnelConfigSchema, undefined, ["sessionId"])
  transport(@Req() req: AuthRequest, @Param("sessionId") id: string) {
    return issueGameTransport(req.user, id);
  }
}
