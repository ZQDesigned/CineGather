export class Metrics {
  private requests = 0;
  private errors = 0;
  private authDenied = 0;
  private durationMs = 0;
  observe(status: number, elapsed: number) {
    this.requests++;
    this.durationMs += elapsed;
    if (status >= 500) this.errors++;
    if (status === 401 || status === 403) this.authDenied++;
  }
  snapshot() {
    return {
      uptimeSeconds: Math.round(process.uptime()),
      requests: this.requests,
      errors: this.errors,
      authDenied: this.authDenied,
      averageDurationMs: this.requests
        ? Math.round(this.durationMs / this.requests)
        : 0,
    };
  }
}
