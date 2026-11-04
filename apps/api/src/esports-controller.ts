import { shareQualityInput } from "@cinegather/contracts";
import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Req,
  Body,
  HttpCode,
  Patch,
} from "@nestjs/common";
import { z } from "zod";
import {
  esportsSnapshotSchema,
  esportsSeatSchema,
  esportsWatchInput,
  esportsMonitorInput,
  esportsConnectionInput,
  esportsConnectionSchema,
  esportsNativeInput,
  nativePublicationSchema,
  leaseSchema,
  leaseInput,
  okSchema,
  esportsSettingsInput,
  coachVoiceModeSchema,
} from "@cinegather/contracts";
import { Endpoint, parse, type AuthRequest } from "./http";
import * as e from "./esports";
import * as settings from "./esports-configuration";
import { admissionSecretValid, admitMediaToken } from "./esports-admission";
import { fail } from "./errors";
const esportsLease = leaseSchema.extend({ publicationId: z.uuid() });
@Controller("api/v1/rooms/:roomId/esports")
export class EsportsController {
  @Patch("settings")
  @Endpoint("esportsSettings", esportsSnapshotSchema, esportsSettingsInput, [
    "roomId",
  ])
  settings(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return settings.updateEsportsConfiguration(
      req.user,
      roomId,
      parse(esportsSettingsInput, body),
    );
  }
  @Post("tactical-pause")
  @Endpoint(
    "esportsTacticalPause",
    esportsSnapshotSchema,
    z.strictObject({ active: z.boolean() }),
    ["roomId"],
    201,
  )
  pause(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return settings.setTacticalPause(
      req.user,
      roomId,
      parse(z.strictObject({ active: z.boolean() }), body).active,
    );
  }
  @Post("coach-voice")
  @Endpoint(
    "esportsCoachVoice",
    esportsSnapshotSchema,
    z.strictObject({ mode: coachVoiceModeSchema }),
    ["roomId"],
    201,
  )
  coachVoice(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return settings.setCoachVoiceMode(
      req.user,
      roomId,
      parse(z.strictObject({ mode: coachVoiceModeSchema }), body).mode,
    );
  }
  @Get()
  @Endpoint("esportsSnapshot", esportsSnapshotSchema, undefined, ["roomId"])
  snapshot(@Req() req: AuthRequest, @Param("roomId") roomId: string) {
    return e.snapshot(req.user, roomId);
  }
  @Post("members/:userId/seat")
  @Endpoint(
    "esportsAssignSeat",
    esportsSnapshotSchema,
    esportsSeatSchema,
    ["roomId", "userId"],
    201,
  )
  seat(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Param("userId") userId: string,
    @Body() body: unknown,
  ) {
    return e.assignSeat(
      req.user,
      roomId,
      userId,
      parse(esportsSeatSchema, body),
    );
  }
  @Post("watch")
  @Endpoint(
    "esportsWatch",
    esportsSnapshotSchema,
    esportsWatchInput,
    ["roomId"],
    201,
  )
  watch(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return e.changeWatch(req.user, roomId, parse(esportsWatchInput, body));
  }
  @Post("monitor")
  @Endpoint(
    "esportsMonitor",
    esportsSnapshotSchema,
    esportsMonitorInput,
    ["roomId"],
    201,
  )
  monitor(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return e.changeMonitor(req.user, roomId, parse(esportsMonitorInput, body));
  }
  @Post("connection")
  @Endpoint(
    "esportsConnection",
    esportsConnectionSchema,
    esportsConnectionInput,
    ["roomId"],
    201,
  )
  connection(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return e.connection(req.user, roomId, parse(esportsConnectionInput, body));
  }
  @Post("share-lease")
  @Endpoint(
    "esportsAcquireLease",
    esportsLease,
    shareQualityInput,
    ["roomId"],
    201,
  )
  lease(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return e.acquireEsportsLease(
      req.user,
      roomId,
      parse(shareQualityInput, body ?? {}).quality,
    );
  }
  @Post("share-lease/renew")
  @Endpoint("esportsRenewLease", esportsLease, leaseInput, ["roomId"], 201)
  renew(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return e.renewEsportsLease(req.user, roomId, parse(leaseInput, body));
  }
  @Delete("share-lease")
  @Endpoint("esportsReleaseLease", okSchema, leaseInput, ["roomId"])
  release(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return e.renewEsportsLease(req.user, roomId, parse(leaseInput, body), true);
  }
  @Post("share-lease/native")
  @Endpoint(
    "esportsNativePublication",
    nativePublicationSchema.extend({ publicationId: z.uuid() }),
    esportsNativeInput,
    ["roomId"],
    201,
  )
  native(
    @Req() req: AuthRequest,
    @Param("roomId") roomId: string,
    @Body() body: unknown,
  ) {
    return e.esportsNative(req.user, roomId, parse(esportsNativeInput, body));
  }
}
@Controller("api/v1/internal/esports-admission")
export class EsportsAdmissionController {
  @Get()
  @HttpCode(204)
  async admit(@Req() req: AuthRequest) {
    if (!admissionSecretValid(req.get("X-CineGather-Admission")))
      fail(401, "UNAUTHORIZED", "没有访问权限");
    const auth = req.get("Authorization");
    if (!auth?.startsWith("Bearer "))
      fail(401, "MEDIA_TOKEN_REQUIRED", "缺少媒体授权");
    await admitMediaToken(auth.slice(7), undefined, () =>
      (
        req.app.get(
          "cinegather.featurePolicy",
        ) as import("./feature-policy").FeaturePolicyStore
      ).snapshot(),
    );
  }
}
