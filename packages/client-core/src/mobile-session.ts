import { sessionSchema, type User } from "@cinegather/contracts";

export interface MobileCredentials {
  user: User;
  sessionToken: string;
  expiresAt: string;
}
export interface MobileSessionDependencies {
  storage: {
    read(): Promise<string | undefined>;
    write(token: string): Promise<void>;
    clear(): Promise<void>;
  };
  profile(token: string): Promise<User>;
  revoke(token: string): Promise<void>;
}
export interface MobileSessionSnapshot {
  status: "restoring" | "signed-out" | "signing-in" | "signed-in";
  user?: User;
  error?: string;
  canRetryRestore: boolean;
}

// Account state and secure-store mutations share one revision. A write already
// handed to the OS cannot be canceled, so newer writes must follow it in order.
export class MobileSession {
  #token?: string;
  private revision = 0;
  private persistence = Promise.resolve();
  private listeners = new Set<() => void>();
  private current: MobileSessionSnapshot = {
    status: "signed-out",
    canRetryRestore: false,
  };
  constructor(private readonly deps: MobileSessionDependencies) {}
  snapshot = () => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getToken() {
    return this.#token;
  }
  private publish(next: MobileSessionSnapshot) {
    this.current = next;
    for (const listener of this.listeners) listener();
  }
  private persist(revision: number, action: () => Promise<void>) {
    const run = this.persistence.then(async () => {
      if (revision !== this.revision) return false;
      await action();
      return true;
    });
    this.persistence = run.then(
      () => {},
      () => {},
    );
    return run;
  }
  private async revoke(token: string) {
    if (token === this.#token) return;
    await this.deps.revoke(token).catch(() => {});
  }
  async authenticate(request: () => Promise<MobileCredentials>) {
    const revision = ++this.revision;
    this.#token = undefined;
    this.publish({ status: "signing-in", canRetryRestore: false });
    let credentials: MobileCredentials | undefined;
    try {
      credentials = sessionSchema.parse(await request());
      if (!credentials.sessionToken || credentials.sessionToken.length > 4096)
        throw new Error("登录响应不可用，请重试");
      if (revision !== this.revision) {
        await this.revoke(credentials.sessionToken);
        return false;
      }
      const token = credentials.sessionToken;
      if (
        !(await this.persist(revision, () => this.deps.storage.write(token))) ||
        revision !== this.revision
      ) {
        await this.revoke(token);
        return false;
      }
      this.#token = token;
      this.publish({
        status: "signed-in",
        user: credentials.user,
        canRetryRestore: false,
      });
      return true;
    } catch (error) {
      if (credentials?.sessionToken)
        await this.revoke(credentials.sessionToken);
      if (revision === this.revision) {
        if (credentials)
          await this.persist(revision, () => this.deps.storage.clear()).catch(
            () => {},
          );
        if (revision === this.revision)
          this.publish({
            status: "signed-out",
            canRetryRestore: false,
            error:
              error instanceof Error
                ? error.message.slice(0, 500)
                : "登录失败，请重试",
          });
      }
      return false;
    }
  }
  async restore() {
    const revision = ++this.revision;
    this.#token = undefined;
    this.publish({ status: "restoring", canRetryRestore: false });
    let token: string | undefined;
    try {
      await this.persistence;
      token = await this.deps.storage.read();
      if (revision !== this.revision) return false;
      if (!token) {
        this.publish({ status: "signed-out", canRetryRestore: false });
        return false;
      }
      const user = await this.deps.profile(token);
      if (revision !== this.revision) return false;
      this.#token = token;
      this.publish({ status: "signed-in", user, canRetryRestore: false });
      return true;
    } catch (error) {
      if (revision !== this.revision) return false;
      const unauthorized =
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 401;
      if (unauthorized)
        await this.persist(revision, () => this.deps.storage.clear()).catch(
          () => {},
        );
      if (revision === this.revision)
        this.publish({
          status: "signed-out",
          canRetryRestore: Boolean(token && !unauthorized),
          error: unauthorized
            ? "登录已过期，请重新登录"
            : "暂时无法恢复登录，请检查网络后重试",
        });
      return false;
    }
  }
  async signOut() {
    const token = this.#token;
    const revision = ++this.revision;
    this.#token = undefined;
    this.publish({ status: "signed-out", canRetryRestore: false });
    try {
      await this.persist(revision, () => this.deps.storage.clear());
    } finally {
      if (token) await this.revoke(token);
    }
  }
  async invalidate(expectedToken: string) {
    if (!expectedToken || this.#token !== expectedToken) return false;
    await this.signOut();
    return true;
  }
}
