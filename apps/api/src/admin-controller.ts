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
import { ApiBearerAuth, ApiQuery } from "@nestjs/swagger";
import * as c from "@cinegather/contracts";
import * as admin from "./admin";
import { Endpoint, parse, AdminGuard, type AuthRequest } from "./http";
@ApiBearerAuth()
@Controller("api/v1/admin")
@UseGuards(AdminGuard)
export class AdminController {
  @Get("overview")
  @Endpoint("adminOverview", c.adminOverviewSchema)
  overview() {
    return admin.overview();
  }
  @Get("users")
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @Endpoint("adminUsers", c.adminUsersSchema)
  users(@Query() query: unknown) {
    return admin.listUsers(parse(c.adminQuery, query));
  }
  @Get("rooms")
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @Endpoint("adminRooms", c.adminRoomsSchema)
  rooms(@Query() query: unknown) {
    return admin.listRooms(parse(c.adminQuery, query));
  }
  @Get("audit")
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @Endpoint("adminAudit", c.adminAuditsSchema)
  audit(@Query() query: unknown) {
    return admin.listAudit(parse(c.adminQuery, query));
  }
  @Post("users/:userId/disable")
  @Endpoint("adminDisableUser", c.okSchema, c.adminReason, ["userId"], 201)
  disable(
    @Req() req: AuthRequest,
    @Param("userId") id: string,
    @Body() body: unknown,
  ) {
    return admin.manageUser(
      req.user,
      id,
      "disable",
      parse(c.adminReason, body).reason,
    );
  }
  @Post("users/:userId/enable")
  @Endpoint("adminEnableUser", c.okSchema, c.adminReason, ["userId"], 201)
  enable(
    @Req() req: AuthRequest,
    @Param("userId") id: string,
    @Body() body: unknown,
  ) {
    return admin.manageUser(
      req.user,
      id,
      "enable",
      parse(c.adminReason, body).reason,
    );
  }
  @Post("users/:userId/revoke-sessions")
  @Endpoint("adminRevokeSessions", c.okSchema, c.adminReason, ["userId"], 201)
  revoke(
    @Req() req: AuthRequest,
    @Param("userId") id: string,
    @Body() body: unknown,
  ) {
    return admin.manageUser(
      req.user,
      id,
      "revoke-sessions",
      parse(c.adminReason, body).reason,
    );
  }
  @Post("rooms/:roomId/close")
  @Endpoint("adminCloseRoom", c.okSchema, c.adminReason, ["roomId"], 201)
  close(
    @Req() req: AuthRequest,
    @Param("roomId") id: string,
    @Body() body: unknown,
  ) {
    return admin.manageRoom(
      req.user,
      id,
      "close",
      parse(c.adminReason, body).reason,
    );
  }
  @Post("rooms/:roomId/revoke-share")
  @Endpoint("adminRevokeShare", c.okSchema, c.adminReason, ["roomId"], 201)
  share(
    @Req() req: AuthRequest,
    @Param("roomId") id: string,
    @Body() body: unknown,
  ) {
    return admin.manageRoom(
      req.user,
      id,
      "revoke-share",
      parse(c.adminReason, body).reason,
    );
  }
}
