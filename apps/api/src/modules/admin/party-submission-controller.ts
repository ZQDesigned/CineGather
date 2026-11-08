import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import * as c from "@cinegather/contracts";
import { ApiQuery } from "@nestjs/swagger";
import {
  AdminGuard,
  Endpoint,
  RequireAdminPermission,
  parse,
  type AuthRequest,
} from "../../core/http";
import * as submissions from "../party/party-submissions";
@Controller("api/v1/admin/party-submissions")
@UseGuards(AdminGuard)
export class AdminPartySubmissionController {
  @Get()
  @RequireAdminPermission("party-submissions.read")
  @ApiQuery({
    name: "status",
    required: false,
    enum: ["all", ...c.partySubmissionStatus.options],
  })
  @ApiQuery({ name: "q", required: false, type: String })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @Endpoint("adminPartySubmissions", c.partySubmissionsSchema)
  list(@Req() req: AuthRequest, @Query() query: unknown) {
    return submissions.listSubmissions(
      req.user,
      parse(c.partySubmissionQuery, query),
      true,
    );
  }
  @Get(":id")
  @RequireAdminPermission("party-submissions.read")
  @Endpoint("adminPartySubmission", c.partySubmissionSchema, undefined, ["id"])
  read(@Req() req: AuthRequest, @Param("id") id: string) {
    return submissions.readSubmission(req.user, id, true);
  }
  @Post(":id/review")
  @RequireAdminPermission("party-submissions.review")
  @Endpoint(
    "reviewPartySubmission",
    c.partySubmissionSchema,
    c.partySubmissionReview,
    ["id"],
    201,
  )
  review(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return submissions.reviewSubmission(
      req.user,
      id,
      parse(c.partySubmissionReview, body),
    );
  }
}
