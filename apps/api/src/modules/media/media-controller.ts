import { participantOwner } from "@cinegather/contracts";
import { Controller, HttpCode, Post, Req, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { fail } from "../../core/errors";
import { type AuthRequest } from "../../core/http";
import * as r from "../rooms/rooms";
import { media } from "./media";

@ApiBearerAuth()
@ApiTags("Api")
@Controller("api/v1")
export class MediaController {
  @Post("livekit/webhook")
  @ApiOperation({ operationId: "ApiController_webhook", summary: undefined })
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
    if (event.room?.name && /^[a-f0-9-]{36}$/i.test(event.room.name))
      await r.reconcileRoom(
        event.room.name,
        event.event === "participant_left" && event.participant
          ? (participantOwner(event.participant.identity) ??
              event.participant.identity)
          : undefined,
      );
    res.json({ ok: true });
  }
}
