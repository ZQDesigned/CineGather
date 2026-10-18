import { applyDecorators, Catch, HttpException, type ArgumentsHost, type ExceptionFilter, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiParam, type SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';
import type { Request, Response } from 'express';
import type { User } from '@cinegather/contracts';
import { authenticate } from './auth';
import { fail } from './errors';
export type AuthRequest = Request & { user: User; requestId: string };
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) fail(400, 'INVALID_INPUT', result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return result.data;
}
function openSchema(schema: z.ZodType): SchemaObject {
  const result = z.toJSONSchema(schema, { target: 'openapi-3.0' });
  return result as SchemaObject;
}
export function Endpoint(operationId: string, output: z.ZodType, input?: z.ZodType, params: string[] = [], status = 200) {
  return applyDecorators(ApiOperation({ operationId }), ApiResponse({ status, schema: openSchema(output) }),
    ...[400, 401, 403, 404, 409, 429, 503].map(code => ApiResponse({ status: code, schema: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, requestId: { type: 'string' } }, required: ['code', 'message', 'requestId'] } })),
    ...(input ? [ApiBody({ schema: openSchema(input) })] : []),
    ...params.map(name => ApiParam({ name, type: 'string', format: 'uuid' })));
}
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (['/api/v1/health', '/api/v1/guests', '/api/v1/livekit/webhook'].includes(req.path)) return true;
    req.user = await authenticate(req.headers.authorization);
    return true;
  }
}
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<AuthRequest>();
    const status = error instanceof HttpException ? error.getStatus() : 503;
    const body = error instanceof HttpException ? error.getResponse() : {};
    const details = typeof body === 'object' ? body as Record<string, unknown> : {};
    res.status(status).json({ code: details.code ?? (status === 503 ? 'SERVICE_UNAVAILABLE' : 'REQUEST_FAILED'), message: details.message ?? (status === 503 ? '服务暂时不可用，请稍后重试' : '请求失败'), requestId: req.requestId });
    if (status >= 500) console.error(JSON.stringify({ event: 'request.failed', requestId: req.requestId, errorType: error instanceof Error ? error.name : 'Unknown' }));
  }
}
