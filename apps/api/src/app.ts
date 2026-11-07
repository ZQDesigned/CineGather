import { gameTunnelHttp } from "./modules/games/game-tunnel-http";
import { RoomActivityController } from "./modules/activities/room-activity-controller";
import { attachActivityGateway } from "./modules/activities/room-activity-gateway";
import {
  tickRoomActivities,
  cleanupWhiteboardArchives,
} from "./modules/activities/room-activities";
import { GameTunnelController } from "./modules/games/game-tunnel-controller";
import { json, urlencoded } from "express";
import { gameTransaction } from "./modules/games/game-link-access";
import { z } from "zod";
import { featureUpdateIssueSchema } from "@cinegather/contracts";
import { join } from "node:path";
import { FeaturePolicyStore } from "./modules/updates/feature-policy";
import type { FeaturePolicy } from "@cinegather/contracts";
import { reconcileTacticalPauses } from "./modules/esports/esports-configuration";
import { MobileUpdateStore } from "./modules/updates/mobile-update-store";
import { serveMobileUpdate } from "./modules/updates/mobile-update-http";
import {
  mobileCompatibilityFailure,
  mobileUpdateExempt,
} from "./modules/updates/mobile-updates";
import "reflect-metadata";
import {
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { AnnouncementScheduler } from "./modules/announcements/announcement-scheduler";
import {
  EsportsController,
  EsportsAdmissionController,
} from "./modules/esports/esports-controller";
import { admissionSecretValid } from "./modules/esports/esports-admission";
import { AdminController } from "./modules/admin/admin-controller";
import { ApiController } from "./controller";
import { GameLinkController } from "./modules/games/game-link-controller";
import {
  AuthGuard,
  ErrorFilter,
  requestIdentity,
  type AuthRequest,
} from "./core/http";
import { cdnClientIp } from "./core/client-ip";
import { config } from "./config";
import { database } from "./core/context";
import { reconcileAll } from "./modules/rooms/rooms";
import { Metrics } from "./core/metrics";
import { UpdateEvents } from "./modules/updates/update-events";
import { compatibilityFailure } from "./modules/updates/client-policy";
import { attachEsportsGateway } from "./modules/esports/esports-gateway";
import { readMaintenance, maintenanceGate } from "./core/maintenance";
import type { ClientPolicy } from "@cinegather/contracts";
class Reconciler implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  onModuleInit() {
    this.timer = setInterval(() => void this.run(), 5000);
    this.timer.unref();
  }
  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      await reconcileAll();
      await gameTransaction(async () => {});
    } catch {
      console.error(JSON.stringify({ event: "reconcile.failed" }));
    } finally {
      this.running = false;
    }
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
class RoomActivityClock implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  onModuleInit() {
    this.timer = setInterval(() => {
      if (this.busy) return;
      this.busy = true;
      void tickRoomActivities()
        .then(() => cleanupWhiteboardArchives())
        .catch(() =>
          console.error(JSON.stringify({ event: "activity.tick_failed" })),
        )
        .finally(() => {
          this.busy = false;
        });
    }, 1000);
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
class TacticalPauses implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  async onModuleInit() {
    await this.run();
    this.timer = setInterval(() => void this.run(), 1000);
    this.timer.unref();
  }
  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      await reconcileTacticalPauses();
    } catch {
      console.error(
        JSON.stringify({ event: "esports.pause_reconcile_failed" }),
      );
    } finally {
      this.running = false;
    }
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
@Module({
  controllers: [
    RoomActivityController,
    ApiController,
    GameLinkController,
    GameTunnelController,
    AdminController,
    EsportsController,
    EsportsAdmissionController,
  ],
  providers: [
    RoomActivityClock,
    Metrics,
    Reconciler,
    TacticalPauses,
    UpdateEvents,
    AnnouncementScheduler,
  ],
})
class AppModule {}
export async function createApp({
  trustedProxies = config.trustedProxies,
  trustedCdns = config.trustedCdns,
  clientPolicy = config.clientPolicy,
  updateDirectory = config.updateDirectory,
  maintenanceFile = config.maintenanceFile,
  featurePolicy,
}: {
  trustedProxies?: string[];
  trustedCdns?: string[];
  clientPolicy?: ClientPolicy;
  updateDirectory?: string;
  maintenanceFile?: string;
  featurePolicy?: FeaturePolicy;
} = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
    rawBody: true,
    bodyParser: true,
  });
  app.set("trust proxy", trustedProxies.length ? trustedProxies : false);
  const resolveIp = cdnClientIp(trustedCdns);
  const trustProxy = app
    .getHttpAdapter()
    .getInstance()
    .get("trust proxy fn") as (ip: string, hop: number) => boolean;
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const ip = resolveIp(
      !!req.socket.remoteAddress && trustProxy(req.socket.remoteAddress, 0),
      req.ip,
      req.get("EO-Connecting-IP"),
    );
    if (ip) Object.defineProperty(req, "ip", { value: ip, configurable: true });
    next();
  });
  app.set("cinegather.clientPolicy", clientPolicy);
  const featurePolicies = new FeaturePolicyStore(
    featurePolicy ? undefined : join(updateDirectory, "feature-policy.json"),
    featurePolicy,
  );
  await featurePolicies.start();
  app.set("cinegather.featurePolicy", featurePolicies);
  const closeFeatures = app.close.bind(app);
  app.close = async () => {
    featurePolicies.close();
    await closeFeatures();
  };
  const events = app.get(UpdateEvents);
  events.start(updateDirectory);
  app.set("cinegather.updateEvents", events);
  app.enableCors({
    origin: [...config.corsOrigins, "app://cinegather"],
    methods: ["GET", "POST", "PATCH", "DELETE"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Idempotency-Key",
      "X-CineGather-Features",
      "X-CineGather-Protocols",
      "X-CineGather-Version",
      "X-CineGather-Platform",
      "X-CineGather-Runtime",
      "X-CineGather-Build",
      "X-CineGather-Revision",
      "X-CineGather-Channel",
    ],
    exposedHeaders: [
      "X-CineGather-Server-Time",
      "X-Request-Id",
      "X-CineGather-Min-Version",
      "X-CineGather-Update-Scope",
      "X-CineGather-Maintenance",
      "Retry-After",
    ],
  });
  app.use(maintenanceGate(maintenanceFile));
  app.use("/api/v1/rooms/:roomId/activity/images", json({ limit: "3mb" }));
  app.use("/api/v1/admin/party-words/import", json({ limit: "2mb" }));
  const activitiesGateway = attachActivityGateway(
    app.getHttpServer(),
    () => !!readMaintenance(maintenanceFile),
  );
  app.getHttpServer().once("close", () => activitiesGateway.close());
  const closeActivities = app.close.bind(app);
  app.close = async () => {
    activitiesGateway.close();
    await closeActivities();
  };
  app.use(
    "/api/v1/game-tunnel/identity/token",
    urlencoded({ extended: false, limit: "8kb" }),
  );
  app.use("/api/v1/internal/game-tunnel", json({ limit: "16kb" }));
  app.use(gameTunnelHttp);
  const mediaGateway = attachEsportsGateway(
    app.getHttpServer(),
    config.livekitInternalUrl,
    () => !!readMaintenance(maintenanceFile),
    () => featurePolicies.snapshot(),
  );
  app.use(mediaGateway.middleware);
  app.getHttpServer().once("close", () => mediaGateway.close());
  const mobileUpdates = new MobileUpdateStore(updateDirectory);
  const buckets = new Map<string, { count: number; reset: number }>();
  function consume(key: string, limit: number, now: number) {
    let bucket = buckets.get(key);
    if (!bucket || bucket.reset <= now) {
      if (buckets.size >= 20000 && !bucket) return now + 60000;
      bucket = { count: 0, reset: now + 60000 };
      buckets.set(key, bucket);
    }
    return ++bucket.count > limit ? bucket.reset : undefined;
  }
  const metrics = app.get(Metrics);
  app.use(
    async (
      req: Request & Partial<AuthRequest>,
      res: Response,
      next: NextFunction,
    ) => {
      req.requestId = randomUUID();
      res.setHeader("X-Request-Id", req.requestId);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      const start = performance.now();
      res.on("finish", () => {
        const durationMs = Math.round(performance.now() - start);
        metrics.observe(res.statusCode, durationMs);
        if (process.env.REQUEST_LOGS === "1")
          console.log(
            JSON.stringify({
              event: "request.completed",
              requestId: req.requestId,
              sessionId: req.sessionId,
              roomId: req.params.roomId,
              method: req.method,
              route: req.route?.path ?? "unmatched",
              status: res.statusCode,
              durationMs,
            }),
          );
      });
      if (
        (req.path === "/api/v1/internal/esports-admission" &&
          admissionSecretValid(req.get("X-CineGather-Admission"))) ||
        req.path.endsWith("/health") ||
        req.path.endsWith("/livekit/webhook")
      ) {
        next();
        return;
      }
      const now = Date.now();
      if (buckets.size > 10000)
        for (const [key, b] of buckets) if (b.reset <= now) buckets.delete(key);
      const limited = req.path.startsWith("/api/v1/accounts/");
      // Only a verified credential earns the shared-NAT allowance. Reuse this
      // request's authentication in the guard; invalid bearer stays at 600/IP.
      const identity =
        !limited && req.headers.authorization
          ? await requestIdentity(req).catch(() => undefined)
          : undefined;
      const reset =
        consume(
          `${req.ip}:${limited ? "auth" : identity ? "authenticated" : "api"}`,
          limited ? 60 : identity ? 3600 : 600,
          now,
        ) ?? (identity ? consume(`user:${identity.id}`, 600, now) : undefined);
      if (reset) {
        res
          .status(429)
          .setHeader(
            "Retry-After",
            String(Math.max(1, Math.ceil((reset - now) / 1000))),
          );
        res.json({
          code: "RATE_LIMITED",
          message: "操作太频繁，请稍后重试",
          requestId: req.requestId,
        });
        return;
      }
      if (
        req.method === "GET" &&
        req.path.startsWith("/api/v1/mobile-updates/")
      ) {
        serveMobileUpdate(mobileUpdates, req, res);
        return;
      }
      const mobilePlatform = req.get("X-CineGather-Platform");
      if (
        (mobilePlatform === "android" || mobilePlatform === "ios") &&
        !mobileUpdateExempt(req.method, req.path)
      ) {
        try {
          const policy = mobileUpdates.policy(
            mobilePlatform,
            req.get("X-CineGather-Channel") ?? "stable",
            req.get("X-CineGather-Runtime") ?? "unknown",
          );
          const mobileFailure =
            policy &&
            mobileCompatibilityFailure(
              req.method,
              req.path,
              {
                build: req.get("X-CineGather-Build"),
                runtime: req.get("X-CineGather-Runtime"),
                revision: req.get("X-CineGather-Revision"),
              },
              policy,
            );
          if (mobileFailure) {
            res
              .status(426)
              .setHeader("X-CineGather-Mobile-Update", mobileFailure.kind)
              .json({
                code: "MOBILE_UPDATE_REQUIRED",
                message: mobileFailure.reason,
                requestId: req.requestId,
              });
            return;
          }
        } catch {
          res.status(503).json({
            code: "UPDATE_POLICY_UNAVAILABLE",
            message: "版本策略暂不可用，请稍后重试",
            requestId: req.requestId,
          });
          return;
        }
      }
      const failure = compatibilityFailure(
        req.method,
        req.path,
        req.get("X-CineGather-Platform"),
        req.get("X-CineGather-Version"),
        clientPolicy,
      );
      if (failure) {
        res
          .status(426)
          .setHeader("X-CineGather-Min-Version", failure.minimumVersion);
        res.json({
          code: "CLIENT_UPDATE_REQUIRED",
          message: failure.reason,
          requestId: req.requestId,
        });
        return;
      }
      next();
    },
  );
  app.useBodyParser("json", {
    type: ["application/json", "application/webhook+json"],
    limit: "64kb",
  });
  app.useGlobalGuards(new AuthGuard());
  app.useGlobalFilters(new ErrorFilter());
  return app;
}
export function openapi(app: Awaited<ReturnType<typeof createApp>>) {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("CineGather API")
      .setVersion("0.1.0")
      .addBearerAuth()
      .build(),
  );
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.FeatureUpdateIssue = z.toJSONSchema(
    featureUpdateIssueSchema,
    { target: "openapi-3.0" },
  ) as import("@nestjs/swagger").SchemaObject;
  return document;
}
export async function closeDatabase() {
  await database.pool.end();
}
