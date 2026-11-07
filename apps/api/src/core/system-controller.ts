import * as c from "@cinegather/contracts";
import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { media } from "../modules/media/media";
import type { UpdateEvents } from "../modules/updates/update-events";
import { db } from "./context";
import { Endpoint, type AuthRequest } from "./http";
import { Metrics } from "./metrics";
import { ServerDiagnostics } from "./server-diagnostics";
const serverDiagnostics = new ServerDiagnostics();

@ApiBearerAuth()
@ApiTags("Api")
@Controller("api/v1")
export class SystemController {
  constructor(@Inject(Metrics) private readonly metrics: Metrics) {}

  @Get("health")
  @Endpoint(
    "health",
    z.object({
      ok: z.literal(true),
      database: z.literal("up"),
      media: z.literal("up"),
      version: z.string(),
      runtime: z.string(),
    }),
  )
  async health() {
    await db.execute("SELECT 1");
    await media.client.listRooms();
    return {
      ok: true,
      database: "up",
      media: "up",
      version: "0.1.0",
      runtime:
        typeof Bun !== "undefined"
          ? `bun ${Bun.version}`
          : `node ${process.versions.node}`,
    };
  }

  @Get("client-policy")
  @Endpoint("clientPolicy", c.clientPolicySchema)
  clientPolicy(@Req() req: AuthRequest) {
    return c.clientPolicySchema.parse(req.app.get("cinegather.clientPolicy"));
  }

  @Get("feature-policy")
  @Endpoint("featurePolicy", c.featurePolicySchema)
  featurePolicy(@Req() req: AuthRequest) {
    return (
      req.app.get(
        "cinegather.featurePolicy",
      ) as import("../modules/updates/feature-policy").FeaturePolicyStore
    ).snapshot();
  }

  @Get("client-events")
  @ApiExcludeEndpoint()
  clientEvents(@Req() req: AuthRequest, @Res() res: Response) {
    (req.app.get("cinegather.updateEvents") as UpdateEvents).connect(
      req,
      res,
      () => c.clientPolicySchema.parse(req.app.get("cinegather.clientPolicy")),
      req.app.get("cinegather.featurePolicy"),
    );
  }

  @Get("diagnostics")
  @Endpoint("diagnostics", c.diagnosticServerSchema)
  async diagnostics() {
    const active = await media.client.listRooms();
    return {
      ...this.metrics.snapshot(),
      activeRooms: active.length,
      ...(await serverDiagnostics.snapshot()),
    };
  }
}
