import { ApiError, createApi, unwrap } from "@cinegather/api-client";

type Client = ReturnType<typeof createApi>;
export interface MobileApiTrace {
  operation: string;
  durationMs: number;
  status?: number;
  code?: string;
}

// Bind each request to the account that started it. A late 401 from an old
// login must never clear a newly authenticated account.
export class MobileApi {
  constructor(
    private readonly deps: {
      origin: string;
      platform: "android" | "ios";
      version: string;
      getToken(): string | undefined;
      expire(expectedToken: string): Promise<boolean>;
      trace?(event: MobileApiTrace): void;
    },
  ) {}
  async call<T>(
    operation: string,
    request: (client: Client) => Promise<{
      data?: T;
      error?: { code: string; message: string; requestId: string };
      response: Response;
    }>,
    options: { token?: string | null; invalidate?: boolean } = {},
  ): Promise<T> {
    const token =
      options.token === undefined
        ? this.deps.getToken()
        : (options.token ?? undefined);
    const began = Date.now();
    let status: number | undefined;
    let code: string | undefined;
    try {
      const result = await request(
        createApi(this.deps.origin, () => token, {
          identity: {
            platform: this.deps.platform,
            version: this.deps.version,
          },
        }),
      );
      status = result.response.status;
      return unwrap(result);
    } catch (error) {
      if (error instanceof ApiError) {
        status = error.status;
        code = error.code;
        if (error.status === 401 && token) {
          if (token !== this.deps.getToken())
            throw new ApiError(
              error.code,
              error.message,
              error.status,
              error.requestId,
              true,
            );
          if (options.invalidate !== false) await this.deps.expire(token);
        }
      } else code = "TRANSPORT_FAILED";
      throw error;
    } finally {
      this.deps.trace?.({
        operation,
        durationMs: Date.now() - began,
        status,
        code,
      });
    }
  }
}
