import { MobileUpdateStore } from "./mobile-update-store";
import { serveMobileUpdate } from "./mobile-update-http";
import {
  mobileCompatibilityFailure,
  mobileUpdateExempt,
} from "./mobile-updates";
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
import { AnnouncementScheduler } from "./announcement-scheduler";
import { AdminController } from "./admin-controller";
import { ApiController } from "./controller";
import { AuthGuard, ErrorFilter, type AuthRequest } from "./http";
import { cdnClientIp } from "./client-ip";
import { config } from "./config";
import { database } from "./context";
import { reconcileAll } from "./rooms";
import { Metrics } from "./metrics";
import { UpdateEvents } from "./update-events";
import { compatibilityFailure } from "./client-policy";
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
@Module({
  controllers: [ApiController, AdminController],
  providers: [Metrics, Reconciler, UpdateEvents, AnnouncementScheduler],
})
class AppModule {}
export async function createApp({
  trustedProxies = config.trustedProxies,
  trustedCdns = config.trustedCdns,
  clientPolicy = config.clientPolicy,
  updateDirectory = config.updateDirectory,
}: {
  trustedProxies?: string[];
  trustedCdns?: string[];
  clientPolicy?: ClientPolicy;
  updateDirectory?: string;
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
      "X-CineGather-Version",
      "X-CineGather-Platform",
      "X-CineGather-Runtime",
      "X-CineGather-Build",
      "X-CineGather-Revision",
      "X-CineGather-Channel",
    ],
    exposedHeaders: ["X-Request-Id", "X-CineGather-Min-Version"],
  });
  const mobileUpdates = new MobileUpdateStore(updateDirectory);
  const buckets = new Map<string, { count: number; reset: number }>();
  const metrics = app.get(Metrics);
  app.use(
    (
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
      const key = `${req.ip}:${limited ? "auth" : "api"}`;
      let bucket = buckets.get(key);
      if (!bucket || bucket.reset <= now) {
        bucket = { count: 0, reset: now + 60_000 };
        buckets.set(key, bucket);
      }
      if (++bucket.count > (limited ? 60 : 600)) {
        res
          .status(429)
          .setHeader(
            "Retry-After",
            String(Math.ceil((bucket.reset - now) / 1000)),
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
  return SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("CineGather API")
      .setVersion("0.1.0")
      .addBearerAuth()
      .build(),
  );
}
export async function closeDatabase() {
  await database.pool.end();
}
