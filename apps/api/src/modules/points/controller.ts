import {
  applyDecorators,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Param,
  UseGuards,
} from "@nestjs/common";
import { ApiQuery } from "@nestjs/swagger";
import { z } from "zod";
import * as c from "@cinegather/contracts";
import {
  AdminGuard,
  Endpoint,
  RequireAdminPermission,
  parse,
  type AuthRequest,
} from "../../core/http";
import { db } from "../../core/context";
import * as points from "./service";
const PointsQuery = () =>
  applyDecorators(
    ...["page", "pageSize", "q", "game", "today"].map((name) =>
      ApiQuery({
        name,
        required: false,
        type: ["page", "pageSize"].includes(name) ? Number : String,
      }),
    ),
  );
@Controller("api/v1/points")
export class PointsController {
  @Get()
  @Endpoint("pointsSummary", c.pointsSummarySchema)
  summary(@Req() req: AuthRequest) {
    return db.transaction((tx) => points.readPointsSummary(tx, req.user.id));
  }
  @Get("ledger")
  @PointsQuery()
  @Endpoint("pointsLedger", c.pointsListSchema)
  ledger(@Req() req: AuthRequest, @Query() query: unknown) {
    return points.listPoints(req.user, parse(c.pointsQuerySchema, query));
  }
  @Get("ledger/:id")
  @Endpoint("pointsEntry", c.pointsEntrySchema, undefined, ["id"])
  entry(@Req() req: AuthRequest, @Param("id") id: string) {
    return points.readOwnPointsEntry(req.user, id);
  }
  @Get("rules")
  @Endpoint("pointsRules", c.publicPointsPolicySchema)
  async rules() {
    const p = await points.readPointsPolicy();
    return {
      enabled: p.enabled,
      dailyCap: p.dailyCap,
      games: p.games,
      version: p.version,
    };
  }
}
@Controller("api/v1/admin/points")
@UseGuards(AdminGuard)
export class AdminPointsController {
  @Get("rules")
  @RequireAdminPermission("points.read")
  @Endpoint("adminPointsRules", c.pointsPolicySchema)
  rules(@Req() req: AuthRequest) {
    return points.adminPointsPolicy(req.user);
  }
  @Get("ledger")
  @PointsQuery()
  @RequireAdminPermission("points.read")
  @Endpoint("adminPointsLedger", c.adminPointsListSchema)
  ledger(@Req() req: AuthRequest, @Query() query: unknown) {
    return points.listPoints(req.user, parse(c.pointsQuerySchema, query), true);
  }
  @Get("policies")
  @ApiQuery({ name: "page", required: false, type: Number })
  @RequireAdminPermission("points.read")
  @Endpoint("pointsPolicyHistory", c.pointsPoliciesSchema)
  history(@Req() req: AuthRequest, @Query() query: unknown) {
    return points.pointsPolicyHistory(
      req.user,
      parse(
        z.object({
          page: z.coerce.number().int().min(1).max(100000).default(1),
        }),
        query,
      ).page,
    );
  }
  @Post("rules")
  @RequireAdminPermission("points.manage")
  @Endpoint(
    "updatePointsRules",
    c.pointsPolicySchema,
    c.pointsPolicyInput,
    [],
    201,
  )
  update(@Req() req: AuthRequest, @Body() body: unknown) {
    return points.updatePointsPolicy(
      req.user,
      parse(c.pointsPolicyInput, body),
    );
  }
}
