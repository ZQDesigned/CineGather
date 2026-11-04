import createClient from "openapi-fetch";
import type { paths } from "./schema";
import {
  clientVersionSchema,
  protocolHeaders,
  featureUpdateIssueSchema,
  type FeatureUpdateIssue,
  type ClientPlatform,
} from "@cinegather/contracts";
export type { paths, components, operations } from "./schema";
const staleSessions = new WeakSet<Response>();
export function createApi(
  baseUrl: string,
  getToken: () => string | undefined,
  options: {
    timeoutMs?: number;
    identity?: {
      version: string;
      platform: ClientPlatform;
      mobile?: {
        runtime: string;
        build: number;
        revision: number;
        channel: string;
      };
    };
    onUpdateRequired?: (minimumVersion: string, reason: string) => void;
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("API timeout must be positive");
  const client = createClient<paths>({ baseUrl });
  client.use({
    onRequest({ request }) {
      for (const [key, value] of Object.entries(protocolHeaders))
        request.headers.set(key, value);
      if (options.identity) {
        request.headers.set("X-CineGather-Version", options.identity.version);
        request.headers.set("X-CineGather-Platform", options.identity.platform);
        const mobile = options.identity.mobile;
        if (mobile) {
          request.headers.set("X-CineGather-Runtime", mobile.runtime);
          request.headers.set("X-CineGather-Build", String(mobile.build));
          request.headers.set("X-CineGather-Revision", String(mobile.revision));
          request.headers.set("X-CineGather-Channel", mobile.channel);
        }
      }
      const token = getToken();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return new Request(request, {
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(timeoutMs),
        ]),
      });
    },
    async onResponse({ request, response }) {
      const minimum = response.headers.get("X-CineGather-Min-Version");
      if (
        response.status === 426 &&
        response.headers.get("X-CineGather-Update-Scope") !== "feature" &&
        minimum &&
        clientVersionSchema.safeParse(minimum).success
      ) {
        const body: unknown = await response
          .clone()
          .json()
          .catch(() => undefined);
        const reason =
          body &&
          typeof body === "object" &&
          "message" in body &&
          typeof body.message === "string"
            ? body.message.slice(0, 500)
            : "当前版本已不受支持，请更新后继续使用。";
        if (
          body &&
          typeof body === "object" &&
          "code" in body &&
          body.code === "CLIENT_UPDATE_REQUIRED"
        )
          options.onUpdateRequired?.(minimum, reason);
      }
      if (
        [401, 426].includes(response.status) &&
        request.headers.get("Authorization") !==
          (getToken() ? `Bearer ${getToken()}` : null)
      )
        staleSessions.add(response);
    },
  });
  return client;
}
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
    readonly staleSession = false,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export class FeatureUpdateError extends ApiError {
  constructor(
    readonly compatibility: FeatureUpdateIssue,
    requestId?: string,
    staleSession = false,
    status = 426,
  ) {
    super(
      "FEATURE_UPDATE_REQUIRED",
      compatibility.reason,
      status,
      requestId,
      staleSession,
    );
    this.name = "FeatureUpdateError";
  }
}
export function unwrap<T>(result: {
  data?: T;
  error?: {
    code: string;
    message: string;
    requestId: string;
    compatibility?: unknown;
  };
  response: Response;
}): T {
  if (result.error?.code === "FEATURE_UPDATE_REQUIRED") {
    const issue = featureUpdateIssueSchema.safeParse(
      result.error.compatibility,
    );
    if (issue.success)
      throw new FeatureUpdateError(
        issue.data,
        result.error.requestId,
        staleSessions.has(result.response),
        result.response.status,
      );
  }
  if (result.error)
    throw new ApiError(
      result.error.code,
      result.error.message,
      result.response.status,
      result.error.requestId,
      staleSessions.has(result.response),
    );
  if (result.data === undefined)
    throw new ApiError(
      "EMPTY_RESPONSE",
      "服务返回了空响应",
      result.response.status,
    );
  return result.data;
}
