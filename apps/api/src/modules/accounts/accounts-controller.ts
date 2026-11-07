import { sessionDevice } from "./session-device";
import * as c from "@cinegather/contracts";
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Endpoint, parse, type AuthRequest } from "../../core/http";
import { listSessions, revokeDevices } from "./account-sessions";
import {
  changeAccountPassword,
  changeAccountProfile,
  loginAccount,
  registerAccount,
} from "./accounts";
import { revokeSession } from "./auth";
import { readRegistrationPolicy } from "./registration";

@ApiBearerAuth()
@ApiTags("Api")
@Controller("api/v1")
export class AccountsController {
  @Get("me")
  @Endpoint("me", c.userSchema)
  me(@Req() req: AuthRequest) {
    return req.user;
  }

  @Get("registration")
  @Endpoint("registrationPolicy", c.registrationPolicySchema)
  async registrationPolicy() {
    return { enabled: (await readRegistrationPolicy()).enabled };
  }

  @Post("accounts/register")
  @Endpoint("registerAccount", c.sessionSchema, c.registerInput, [], 201)
  register(@Req() req: AuthRequest, @Body() body: unknown) {
    return registerAccount(parse(c.registerInput, body), req.user, device(req));
  }

  @Post("accounts/login")
  @Endpoint("loginAccount", c.sessionSchema, c.loginInput, [], 201)
  login(@Req() req: AuthRequest, @Body() body: unknown) {
    return loginAccount(
      parse(c.loginInput, body),
      req.ip ?? "unknown",
      device(req),
    );
  }

  @Post("accounts/password")
  @Endpoint("changeAccountPassword", c.sessionSchema, c.passwordInput, [], 201)
  password(@Req() req: AuthRequest, @Body() body: unknown) {
    return changeAccountPassword(
      req.user,
      parse(c.passwordInput, body),
      device(req),
    );
  }

  @Patch("accounts/profile")
  @Endpoint("changeAccountProfile", c.userSchema, c.profileInput)
  profile(@Req() req: AuthRequest, @Body() body: unknown) {
    return changeAccountProfile(req.user, parse(c.profileInput, body));
  }

  @Get("accounts/sessions")
  @Endpoint("listDeviceSessions", c.deviceSessionsSchema)
  sessions(@Req() req: AuthRequest) {
    return listSessions(req.user);
  }

  @Delete("accounts/sessions")
  @Endpoint("revokeOtherSessions", c.okSchema)
  revokeOthers(@Req() req: AuthRequest) {
    return revokeDevices(req.user);
  }

  @Delete("accounts/sessions/:sessionId")
  @Endpoint("revokeDeviceSession", c.okSchema, undefined, ["sessionId"])
  revokeDevice(@Req() req: AuthRequest, @Param("sessionId") id: string) {
    return revokeDevices(req.user, id);
  }

  @Delete("session")
  @Endpoint("revokeSession", c.okSchema)
  async logout(@Req() req: AuthRequest) {
    await revokeSession(req.headers.authorization!);
    return { ok: true };
  }
}

function device(req: AuthRequest) {
  return sessionDevice({
    platform: req.get("X-CineGather-Platform"),
    version: req.get("X-CineGather-Version"),
    agent: req.get("User-Agent"),
    address: req.ip,
  });
}
