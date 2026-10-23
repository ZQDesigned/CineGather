import {
  applyDecorators,
  SetMetadata,
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiParam,
  type SchemaObject,
} from "@nestjs/swagger";
import { z } from "zod";
import type { Request, Response } from "express";
import {
  hasAdminPermission,
  type User,
  type AdminPermission,
} from "@cinegather/contracts";
import { authenticate } from "./auth";
import { fail } from "./errors";
export type AuthRequest = Request & {
  user: User;
  sessionId?: string;
  requestId: string;
};
export function parse<T extends z.ZodType>(
  schema: T,
  value: unknown,
): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success)
    fail(
      400,
      "INVALID_INPUT",
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  return result.data;
}
function openSchema(
  schema: z.ZodType,
  io: "input" | "output" = "output",
): SchemaObject {
  const result = z.toJSONSchema(schema, { target: "openapi-3.0", io });
  return result as SchemaObject;
}
const examples: Record<string, unknown> = {
  createRoom: { name: "今晚一起看", maxMembers: 5 },
  joinRoom: {
    inviteToken: "replace_with_your_valid_43_character_invite_token",
  },
  createInvite: { expiresInHours: 24, maxUses: 10 },
  renewLease: { leaseId: "00000000-0000-4000-8000-000000000000", revision: 1 },
  releaseLease: {
    leaseId: "00000000-0000-4000-8000-000000000000",
    revision: 1,
  },
  postMessage: { body: "今晚一起看！" },
  requestFriend: { userId: "00000000-0000-4000-8000-000000000000" },
  moderate: { ban: true },
};
export function Endpoint(
  operationId: string,
  output: z.ZodType,
  input?: z.ZodType,
  params: string[] = [],
  status = 200,
) {
  return applyDecorators(
    ApiOperation({ operationId }),
    ApiResponse({ status, schema: openSchema(output) }),
    ...[400, 401, 403, 404, 409, 429, 503].map((code) =>
      ApiResponse({
        status: code,
        schema: {
          type: "object",
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            requestId: { type: "string" },
          },
          required: ["code", "message", "requestId"],
        },
      }),
    ),
    ...(input
      ? [
          ApiBody({
            schema: openSchema(input, "input"),
            examples: examples[operationId]
              ? { example: { value: examples[operationId] } }
              : undefined,
          }),
        ]
      : []),
    ...params.map((name) =>
      ApiParam({
        name,
        type: "string",
        ...(operationId === "joinRoom" && name === "roomId"
          ? { description: "8 位房间号或完整房间 UUID" }
          : { format: "uuid" }),
      }),
    ),
  );
}
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (
      [
        "/api/v1/health",
        "/api/v1/registration",
        "/api/v1/accounts/login",
        "/api/v1/livekit/webhook",
      ].includes(req.path)
    )
      return true;
    if (req.path === "/api/v1/accounts/register" && !req.headers.authorization)
      return true;
    const identity = await authenticate(req.headers.authorization);
    req.user = {
      id: identity.id,
      displayName: identity.displayName,
      username: identity.username,
      isSuperAdmin: identity.isSuperAdmin,
      roles: identity.roles,
      permissions: identity.permissions,
    };
    req.sessionId = identity.credentialId;
    return true;
  }
}
const permissionKey = "cinegather.admin.permission";
const superKey = "cinegather.admin.super";
export const RequireAdminPermission = (permission: AdminPermission) =>
  SetMetadata(permissionKey, permission);
export const SuperAdminOnly = () => SetMetadata(superKey, true);
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest<AuthRequest>().user;
    if (Reflect.getMetadata(superKey, context.getHandler())) {
      if (!user?.isSuperAdmin)
        fail(403, "SUPERADMIN_REQUIRED", "仅超级管理员可以执行此管理操作");
    } else {
      const permission = Reflect.getMetadata(
        permissionKey,
        context.getHandler(),
      ) as AdminPermission | undefined;
      if (!permission || !hasAdminPermission(user, permission))
        fail(403, "PERMISSION_DENIED", "没有访问此管理功能的权限");
    }
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
    const details =
      typeof body === "object" ? (body as Record<string, unknown>) : {};
    res.status(status).json({
      code:
        details.code ??
        (status === 503 ? "SERVICE_UNAVAILABLE" : "REQUEST_FAILED"),
      message:
        details.message ??
        (status === 503 ? "服务暂时不可用，请稍后重试" : "请求失败"),
      requestId: req.requestId,
    });
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: "request.failed",
          requestId: req.requestId,
          errorType: error instanceof Error ? error.name : "Unknown",
        }),
      );
  }
}
