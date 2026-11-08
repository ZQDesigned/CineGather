import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import * as c from "@cinegather/contracts";
import {
  Endpoint,
  parse,
  AdminGuard,
  RequireAdminPermission,
  type AuthRequest,
} from "../../core/http";
import * as categories from "../party/party-categories";
@Controller("api/v1/admin/party-categories")
@UseGuards(AdminGuard)
export class PartyCategoryController {
  @Get()
  @RequireAdminPermission("party-words.read")
  @Endpoint("adminPartyCategories", c.partyCatalogSchema)
  catalog() {
    return categories.listPartyCatalog();
  }
  @Post()
  @RequireAdminPermission("party-words.manage")
  @Endpoint(
    "adminCreatePartyCategory",
    c.partyCategorySchema,
    c.partyCategoryInput,
    [],
    201,
  )
  create(@Req() req: AuthRequest, @Body() body: unknown) {
    return categories.savePartyCategory(
      req.user,
      parse(c.partyCategoryInput, body),
    );
  }
  @Post("policy")
  @RequireAdminPermission("party-words.manage")
  @Endpoint(
    "adminSavePartyPolicy",
    c.partyPolicyInput,
    c.partyPolicyInput,
    [],
    201,
  )
  policy(@Req() req: AuthRequest, @Body() body: unknown) {
    return categories.savePartyPolicy(
      req.user,
      parse(c.partyPolicyInput, body),
    );
  }
  @Post("move-words")
  @RequireAdminPermission("party-words.manage")
  @Endpoint("adminMovePartyWords", c.okSchema, c.partyBulkMoveInput, [], 201)
  move(@Req() req: AuthRequest, @Body() body: unknown) {
    return categories.movePartyWords(
      req.user,
      parse(c.partyBulkMoveInput, body),
    );
  }
  @Patch(":id")
  @RequireAdminPermission("party-words.manage")
  @Endpoint(
    "adminEditPartyCategory",
    c.partyCategorySchema,
    c.partyCategoryUpdate,
    ["id"],
  )
  edit(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const { version, ...input } = parse(c.partyCategoryUpdate, body);
    return categories.savePartyCategory(req.user, input, id, version);
  }
  @Post(":id/delete")
  @RequireAdminPermission("party-words.manage")
  @Endpoint(
    "adminDeletePartyCategory",
    c.okSchema,
    c.partyWordVersion,
    ["id"],
    201,
  )
  delete(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return categories.deletePartyCategory(
      req.user,
      id,
      parse(c.partyWordVersion, body).version,
    );
  }
}
