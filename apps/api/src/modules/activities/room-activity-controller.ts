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
import { activityCommandSchema, okSchema } from "@cinegather/contracts";
import { Endpoint, parse, type AuthRequest } from "../../core/http";
import * as activity from "./room-activities";
import { issueActivityTicket } from "./room-activity-gateway";
import {
  readWhiteboardImage,
  uploadWhiteboardImage,
} from "./whiteboard-images";
@Controller("api/v1")
export class RoomActivityController {
  @Get("rooms/:roomId/activity")
  @Endpoint("roomActivity", z.any(), undefined, ["roomId"])
  snapshot(@Req() req: AuthRequest, @Param("roomId") id: string) {
    return activity.activitySnapshot(req.user, id);
  }
  @Post("rooms/:roomId/activity")
  @Endpoint(
    "roomActivityCommand",
    z.any(),
    activityCommandSchema,
    ["roomId"],
    201,
  )
  command(
    @Req() req: AuthRequest,
    @Param("roomId") id: string,
    @Body() body: unknown,
  ) {
    return activity.activityCommand(
      req.user,
      id,
      parse(activityCommandSchema, body),
    );
  }
  @Post("rooms/:roomId/activity/ticket")
  @Endpoint(
    "roomActivityTicket",
    z.object({ ticket: z.string() }),
    undefined,
    ["roomId"],
    201,
  )
  async ticket(@Req() req: AuthRequest, @Param("roomId") id: string) {
    await activity.activitySnapshot(req.user, id);
    return issueActivityTicket(req.user, id);
  }
  @Post("rooms/:roomId/activity/images")
  @Endpoint(
    "uploadWhiteboardImage",
    z.object({ id: z.uuid(), width: z.number(), height: z.number() }),
    z.object({
      generation: z.number().int().nonnegative(),
      data: z.string().max(2_800_000),
    }),
    ["roomId"],
    201,
  )
  upload(
    @Req() req: AuthRequest,
    @Param("roomId") id: string,
    @Body() body: unknown,
  ) {
    return uploadWhiteboardImage(
      req.user,
      id,
      parse(
        z.strictObject({
          generation: z.number().int().nonnegative(),
          data: z.string().max(2_800_000),
        }),
        body,
      ),
    );
  }
  @Get("whiteboards/images/:imageId")
  @Endpoint("whiteboardImage", z.object({ data: z.string() }), undefined, [
    "imageId",
  ])
  image(@Req() req: AuthRequest, @Param("imageId") id: string) {
    return readWhiteboardImage(req.user, id);
  }
  @Get("whiteboards")
  @Endpoint("whiteboards", z.any())
  history(@Req() req: AuthRequest) {
    return activity.listWhiteboards(req.user);
  }
  @Get("whiteboards/:whiteboardId")
  @Endpoint("whiteboard", z.any(), undefined, ["whiteboardId"])
  record(@Req() req: AuthRequest, @Param("whiteboardId") id: string) {
    return activity.getWhiteboard(req.user, id);
  }
  @Delete("whiteboards/:whiteboardId")
  @Endpoint("deleteWhiteboard", okSchema, undefined, ["whiteboardId"])
  remove(@Req() req: AuthRequest, @Param("whiteboardId") id: string) {
    return activity.deleteWhiteboard(req.user, id);
  }
}
