export class NativeProtocol {
  private closed = false;
  private buffer = "";
  private queue: Promise<unknown> = Promise.resolve();
  private pending?: {
    resolve(value: unknown): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  };
  constructor(
    private readonly write: (data: string) => void,
    private readonly kill: () => void,
    private readonly timeout = 15_000,
  ) {}
  call<T = unknown>(command: Record<string, unknown>): Promise<T> {
    const result = this.queue.then(() => {
      if (this.closed) throw new Error("原生采集进程已退出");
      return new Promise<T>((resolve, reject) => {
        this.pending = {
          resolve: (value) => resolve(value as T),
          reject,
          timer: setTimeout(() => {
            this.close(new Error("原生采集响应超时，请重新共享"));
            this.kill();
          }, this.timeout),
        };
        try {
          this.write(JSON.stringify(command) + "\n");
        } catch {
          this.close();
          this.kill();
        }
      });
    });
    this.queue = result.catch(() => {});
    return result;
  }
  receive(chunk: string) {
    if (this.closed) return;
    this.buffer += chunk;
    if (this.buffer.length > 262144) {
      this.close();
      this.kill();
      return;
    }
    const index = this.buffer.indexOf("\n");
    if (index === -1) return;
    const line = this.buffer.slice(0, index);
    this.buffer = this.buffer.slice(index + 1);
    const pending = this.pending;
    if (!pending || this.buffer.length) {
      this.close();
      this.kill();
      return;
    }
    this.pending = undefined;
    clearTimeout(pending.timer);
    try {
      const response = JSON.parse(line);
      if (response.ok === true) pending.resolve(response.data);
      else
        pending.reject(
          new Error(
            typeof response.error === "string"
              ? response.error
              : "原生采集失败",
          ),
        );
    } catch {
      pending.reject(new Error("原生采集协议异常"));
      this.close();
      this.kill();
    }
  }
  close(error = new Error("原生采集进程已退出")) {
    this.closed = true;
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = undefined;
    }
  }
}
