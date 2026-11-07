import * as c from "@cinegather/contracts";
import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Endpoint, parse, type AuthRequest } from "../../core/http";
import * as announcements from "./announcements";

@ApiBearerAuth()
@ApiTags("Api")
@Controller("api/v1")
export class AnnouncementsController {
  @Get("announcements")
  @Endpoint("announcementFeed", c.announcementFeedSchema)
  announcements() {
    return announcements.announcementFeed();
  }

  @Get("announcements/inbox")
  @Endpoint("announcementInbox", c.announcementInboxSchema)
  announcementInbox(@Req() req: AuthRequest) {
    return announcements.announcementInbox(req.user);
  }

  @Post("announcements/receive")
  @Endpoint(
    "receiveAnnouncements",
    c.announcementClaimsSchema,
    c.announcementIdsInput,
    [],
    201,
  )
  receiveAnnouncements(@Req() req: AuthRequest, @Body() body: unknown) {
    return announcements.receiveAnnouncements(
      req.user,
      parse(c.announcementIdsInput, body).ids,
    );
  }

  @Post("announcements/read")
  @Endpoint(
    "readAnnouncements",
    c.announcementClaimsSchema,
    c.announcementIdsInput,
    [],
    201,
  )
  readAnnouncements(@Req() req: AuthRequest, @Body() body: unknown) {
    return announcements.receiveAnnouncements(
      req.user,
      parse(c.announcementIdsInput, body).ids,
      true,
    );
  }

  @Post("announcements/:announcementId/receive")
  @Endpoint(
    "receiveAnnouncement",
    c.announcementReceiptSchema,
    undefined,
    ["announcementId"],
    201,
  )
  receiveAnnouncement(
    @Req() req: AuthRequest,
    @Param("announcementId") id: string,
  ) {
    return announcements.receiveAnnouncement(req.user, id);
  }

  @Post("announcements/:announcementId/read")
  @Endpoint(
    "readAnnouncement",
    c.announcementReceiptSchema,
    undefined,
    ["announcementId"],
    201,
  )
  readAnnouncement(
    @Req() req: AuthRequest,
    @Param("announcementId") id: string,
  ) {
    return announcements.receiveAnnouncement(req.user, id, true);
  }
}
