import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import * as c from "@cinegather/contracts";
import { ApiQuery } from "@nestjs/swagger";
import { Endpoint, parse, type AuthRequest } from "../../core/http";
import * as submissions from "./party-submissions";
import { readSubmissionEligibility } from "./party-learning";
import { listPartyCatalog } from "./party-categories";

@Controller("api/v1/party-submissions")
export class PartySubmissionController {
  @Get("eligibility")
  @Endpoint("partySubmissionEligibility", c.submissionEligibilitySchema)
  eligibility(@Req() req: AuthRequest) {
    return readSubmissionEligibility(req.user);
  }
  @Get("catalog")
  @Endpoint("partySubmissionCatalog", c.partyCatalogSchema)
  catalog() {
    return listPartyCatalog();
  }
  @Get()
  @ApiQuery({
    name: "status",
    required: false,
    enum: ["all", ...c.partySubmissionStatus.options],
  })
  @ApiQuery({ name: "q", required: false, type: String })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @Endpoint("partySubmissions", c.partySubmissionsSchema)
  list(@Req() req: AuthRequest, @Query() query: unknown) {
    return submissions.listSubmissions(
      req.user,
      parse(c.partySubmissionQuery, query),
    );
  }
  @Post()
  @Endpoint(
    "submitPartyQuestion",
    c.partySubmissionSchema,
    c.partySubmissionDraft,
    [],
    201,
  )
  create(@Req() req: AuthRequest, @Body() body: unknown) {
    return submissions.saveSubmission(
      req.user,
      parse(c.partySubmissionDraft, body),
    );
  }
  @Get(":id")
  @Endpoint("partySubmission", c.partySubmissionSchema, undefined, ["id"])
  read(@Req() req: AuthRequest, @Param("id") id: string) {
    return submissions.readSubmission(req.user, id);
  }
  @Patch(":id")
  @Endpoint(
    "editPartySubmission",
    c.partySubmissionSchema,
    c.partySubmissionUpdate,
    ["id"],
  )
  edit(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { version, ...draft } = parse(c.partySubmissionUpdate, body);
    return submissions.saveSubmission(req.user, draft, id, version);
  }
  @Post(":id/withdraw")
  @Endpoint(
    "withdrawPartySubmission",
    c.partySubmissionSchema,
    c.partySubmissionVersion,
    ["id"],
    201,
  )
  withdraw(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return submissions.withdrawSubmission(
      req.user,
      id,
      parse(c.partySubmissionVersion, body).version,
    );
  }
}
