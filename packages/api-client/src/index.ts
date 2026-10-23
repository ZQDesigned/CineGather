import createClient from "openapi-fetch";
import type { paths } from "./schema";
export type { paths, components, operations } from "./schema";
const staleSessions = new WeakSet<Response>();
export function createApi(
  baseUrl: string,
  getToken: () => string | undefined,
  options: { timeoutMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? 15000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error("API timeout must be positive");
  const client = createClient<paths>({ baseUrl });
  client.use({
    onRequest({ request }) {
      const token = getToken();
      if (token) request.headers.set("Authorization", `Bearer ${token}`);
      return new Request(request, {
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(timeoutMs),
        ]),
      });
    },
    onResponse({ request, response }) {
      if (
        response.status === 401 &&
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
export function unwrap<T>(result: {
  data?: T;
  error?: { code: string; message: string; requestId: string };
  response: Response;
}): T {
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
