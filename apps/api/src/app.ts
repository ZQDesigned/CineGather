import 'reflect-metadata';
import { Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { ApiController } from './controller';
import { AuthGuard, ErrorFilter } from './http';
import { config } from './config';
import { database } from './context';
import { reconcileAll } from './rooms';
import { Metrics } from './metrics';
class Reconciler implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>; private running = false;
  onModuleInit() { this.timer = setInterval(() => void this.run(), 5000); this.timer.unref(); }
  private async run() { if (this.running) return; this.running = true; try { await reconcileAll(); } catch { console.error(JSON.stringify({ event: 'reconcile.failed' })); } finally { this.running = false; } }
  onModuleDestroy() { clearInterval(this.timer); }
}
@Module({ controllers: [ApiController], providers: [Metrics, Reconciler] })
class AppModule {}
export async function createApp() {
  const app = await NestFactory.create(AppModule, { logger: false, rawBody: true, bodyParser: true });
  app.enableCors({ origin: [...config.corsOrigins, 'app://cinegather'], methods: ['GET', 'POST', 'DELETE'], allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'], exposedHeaders: ['X-Request-Id'] });
  const buckets = new Map<string, { count: number; reset: number }>();
  const metrics = app.get(Metrics);
  app.use((req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
    req.requestId = randomUUID(); res.setHeader('X-Request-Id', req.requestId); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    const start = performance.now(); res.on('finish', () => metrics.observe(res.statusCode, performance.now() - start));
    if (req.path.endsWith('/health') || req.path.endsWith('/livekit/webhook')) { next(); return; }
    const now = Date.now();
    if (buckets.size > 10000) for (const [key, b] of buckets) if (b.reset <= now) buckets.delete(key);
    const key = `${req.ip}:${req.path.endsWith('/guests') ? 'guest' : 'api'}`;
    let bucket = buckets.get(key); if (!bucket || bucket.reset <= now) { bucket = { count: 0, reset: now + 60_000 }; buckets.set(key, bucket); }
    if (++bucket.count > (key.endsWith(':guest') ? 60 : 600)) { res.status(429).setHeader('Retry-After', String(Math.ceil((bucket.reset - now) / 1000))); res.json({ code: 'RATE_LIMITED', message: '操作太频繁，请稍后重试', requestId: req.requestId }); return; }
    next();
  });
  app.useGlobalGuards(new AuthGuard()); app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
export function openapi(app: Awaited<ReturnType<typeof createApp>>) {
  return SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('CineGather API').setVersion('0.1.0').addBearerAuth().build());
}
export async function closeDatabase() { await database.pool.end(); }
