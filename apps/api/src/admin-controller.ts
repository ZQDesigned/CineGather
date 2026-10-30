import * as announcements from "./announcements";
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Patch,
  Headers,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiQuery, ApiHeader } from "@nestjs/swagger";
import * as c from "@cinegather/contracts";
import * as admin from "./admin";
import {
  readRegistrationPolicy,
  updateRegistrationPolicy,
} from "./registration";
import * as roles from "./roles";
import {
  Endpoint,
  parse,
  AdminGuard,
  RequireAdminPermission,
  SuperAdminOnly,
  type AuthRequest,
} from "./http";
@ApiBearerAuth()
@Controller("api/v1/admin")
@UseGuards(AdminGuard)
export class AdminController {
  @Get("registration")
  @SuperAdminOnly()
  @Endpoint("adminRegistrationPolicy", c.adminRegistrationPolicySchema)
  registrationPolicy() {
    return readRegistrationPolicy();
  }
  @Post("registration")
  @SuperAdminOnly()
  @Endpoint(
    "adminUpdateRegistrationPolicy",
    c.adminRegistrationPolicySchema,
    c.registrationPolicyInput,
    [],
    201,
  )
  updateRegistration(@Req() req: AuthRequest, @Body() body: unknown) {
    return updateRegistrationPolicy(
      req.user,
      parse(c.registrationPolicyInput, body),
    );
  }

  @Get("announcements")
  @RequireAdminPermission("announcements.read")
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @Endpoint("adminAnnouncements", c.adminAnnouncementsSchema)
  announcements(@Query() query: unknown) {
    return announcements.listAdminAnnouncements(parse(c.adminQuery, query));
  }
  @Post("announcements")
  @ApiHeader({ name: "idempotency-key", required: false })
  @RequireAdminPermission("announcements.manage")
  @Endpoint(
    "adminCreateAnnouncement",
    c.announcementSchema,
    c.announcementInput,
    [],
    201,
  )
  createAnnouncement(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @Headers("idempotency-key") key?: string,
  ) {
    return announcements.saveAnnouncement(
      req.user,
      parse(c.announcementInput, body),
      undefined,
      key,
    );
  }
  @Patch("announcements/:announcementId")
  @RequireAdminPermission("announcements.manage")
  @Endpoint(
    "adminEditAnnouncement",
    c.announcementSchema,
    c.announcementInput,
    ["announcementId"],
  )
  editAnnouncement(
    @Req() req: AuthRequest,
    @Param("announcementId") id: string,
    @Body() body: unknown,
  ) {
    return announcements.saveAnnouncement(
      req.user,
      parse(c.announcementInput, body),
      id,
    );
  }
  @Post("announcements/:announcementId/publish")
  @RequireAdminPermission("announcements.manage")
  @Endpoint(
    "adminPublishAnnouncement",
    c.announcementSchema,
    undefined,
    ["announcementId"],
    201,
  )
  publishAnnouncement(
    @Req() req: AuthRequest,
    @Param("announcementId") id: string,
  ) {
    return announcements.publishAnnouncement(req.user, id);
  }
  @Post("announcements/:announcementId/withdraw")
  @RequireAdminPermission("announcements.manage")
  @Endpoint(
    "adminWithdrawAnnouncement",
    c.announcementSchema,
    undefined,
    ["announcementId"],
    201,
  )
  withdrawAnnouncement(
    @Req() req: AuthRequest,
    @Param("announcementId") id: string,
  ) {
    return announcements.withdrawAnnouncement(req.user, id);
  }
  @Get("overview")
  @RequireAdminPermission("overview.read")
  @Endpoint("adminOverview", c.adminOverviewSchema)
  overview() {
    return admin.overview();
  }
  @Get("users")
  @RequireAdminPermission("users.read")
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @Endpoint("adminUsers", c.adminUsersSchema)
  users(@Query() query: unknown) {
    return admin.listUsers(parse(c.adminQuery, query));
  }
  @Get("rooms")
  @RequireAdminPermission("rooms.read")
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @Endpoint("adminRooms", c.adminRoomsSchema)
  rooms(@Query() query: unknown) {
    return admin.listRooms(parse(c.adminQuery, query));
  }
  @Get("audit")
  @RequireAdminPermission("audit.read")
  @ApiQuery({ name: "q", required: false })
  @ApiQuery({ name: "page", required: false, type: Number })
  @ApiQuery({ name: "pageSize", required: false, type: Number })
  @Endpoint("adminAudit", c.adminAuditsSchema)
  audit(@Query() query: unknown) {
    return admin.listAudit(parse(c.adminQuery, query));
  }
  @Post("users/:userId/screen-share")
  @RequireAdminPermission("users.screen-share")
  @Endpoint(
    "adminSetScreenShare",
    c.okSchema,
    c.adminScreenShareInput,
    ["userId"],
    201,
  )
  setScreenShare(
    @Req() req: AuthRequest,
    @Param("userId") id: string,
    @Body() body: unknown,
  ) {
    return admin.setScreenShare(
      req.user,
      id,
      parse(c.adminScreenShareInput, body),
    );
  }
  @Post("users/:userId/disable")
  @RequireAdminPermission("users.manage")
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
  @RequireAdminPermission("users.manage")
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
  @RequireAdminPermission("users.manage")
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
  @RequireAdminPermission("rooms.manage")
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
  @RequireAdminPermission("rooms.manage")
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
  @Get("roles")
  @SuperAdminOnly()
  @Endpoint("adminRoles", c.adminRolesSchema)
  roles() {
    return roles.listRoles();
  }
  @Post("roles")
  @SuperAdminOnly()
  @Endpoint("adminCreateRole", c.adminRoleSchema, c.adminRoleInput, [], 201)
  createRole(@Req() req: AuthRequest, @Body() body: unknown) {
    return roles.createRole(req.user, parse(c.adminRoleInput, body));
  }
  @Post("roles/:roleId")
  @SuperAdminOnly()
  @Endpoint(
    "adminUpdateRole",
    c.adminRoleSchema,
    c.adminRoleInput,
    ["roleId"],
    201,
  )
  updateRole(
    @Req() req: AuthRequest,
    @Param("roleId") id: string,
    @Body() body: unknown,
  ) {
    return roles.updateRole(req.user, id, parse(c.adminRoleInput, body));
  }
  @Post("roles/:roleId/delete")
  @SuperAdminOnly()
  @Endpoint("adminDeleteRole", c.okSchema, c.adminReason, ["roleId"], 201)
  deleteRole(
    @Req() req: AuthRequest,
    @Param("roleId") id: string,
    @Body() body: unknown,
  ) {
    return roles.deleteRole(req.user, id, parse(c.adminReason, body).reason);
  }
  @Post("users/:userId/roles")
  @SuperAdminOnly()
  @Endpoint(
    "adminAssignRoles",
    c.okSchema,
    c.adminRoleAssignment,
    ["userId"],
    201,
  )
  assignRoles(
    @Req() req: AuthRequest,
    @Param("userId") id: string,
    @Body() body: unknown,
  ) {
    return roles.assignRoles(req.user, id, parse(c.adminRoleAssignment, body));
  }
}
