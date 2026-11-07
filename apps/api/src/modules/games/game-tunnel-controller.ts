import { Controller, Get, Param, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { gameTunnelConfigSchema } from "@cinegather/contracts";
import { Endpoint, type AuthRequest } from "../../core/http";
import { issueGameTransport } from "./game-tunnel-auth";
@Controller("api/v1/games")
export class GameTunnelController {
  @Get(":sessionId/transport")
  @Endpoint("gameTransport", gameTunnelConfigSchema, undefined, ["sessionId"])
  async transport(
    @Req() req: AuthRequest,
    @Param("sessionId") id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const config = await issueGameTransport(req.user, id);
    response.setHeader("X-CineGather-Server-Time", String(Date.now()));
    response.setHeader("Cache-Control", "no-store");
    return config;
  }
}
