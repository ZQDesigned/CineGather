interface NotificationClock {
  now(): number;
  set(callback: () => void, delay: number): unknown;
  clear(timer: unknown): void;
}
const realEventClock: NotificationClock = {
  now: Date.now,
  set: (fn, delay) => setTimeout(fn, delay),
  clear: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};
/** A single persistent connection, with backoff instead of rapid version polling. */
export function watchUpdateEvents(
  url: string,
  receive: (
    event: "policy" | "release" | "announcements" | "mobile-update",
    data: string,
  ) => void,
  request: (input: string, init: RequestInit) => Promise<Response> = fetch,
  clock: NotificationClock = realEventClock,
) {
  let stopped = false,
    failures = 0,
    timer: unknown,
    generation = 0,
    lastReconnect = -Infinity;
  let active: AbortController | undefined;
  const connect = async () => {
    if (stopped) return;
    const revision = ++generation;
    const abort = new AbortController();
    active = abort;
    let idle: unknown;
    let retry = Math.min(300000, 15000 * Math.pow(2, Math.min(failures, 5)));
    const started = clock.now();
    const keepalive = () => {
      clock.clear(idle);
      idle = clock.set(() => abort.abort(), 70000);
    };
    try {
      keepalive();
      const response = await request(url, {
        signal: abort.signal,
        cache: "no-store",
        redirect: "error",
        headers: { Accept: "text/event-stream" },
      });
      if (response.status === 404 || response.status === 501)
        retry = 60 * 60 * 1000;
      if (
        !response.ok ||
        !response.headers.get("content-type")?.includes("text/event-stream") ||
        !response.body
      ) {
        const seconds = Number(response.headers.get("retry-after"));
        if (seconds > 0 && Number.isFinite(seconds))
          retry = Math.max(retry, Math.min(seconds, 3600) * 1000);
        throw Error("Notification stream unavailable");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          keepalive();
          buffer += decoder.decode(next.value, { stream: true });
          if (buffer.length > 131072)
            throw Error("Notification frame too large");
          let boundary: RegExpMatchArray | null;
          while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
            const frame = buffer.slice(0, boundary.index),
              lines = frame.split(/\r?\n/);
            buffer = buffer.slice(boundary.index! + boundary[0].length);
            let event = "message";
            const data: string[] = [];
            for (const line of lines) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:"))
                data.push(line.slice(5).replace(/^ /, ""));
            }
            if (
              !stopped &&
              revision === generation &&
              (event === "policy" ||
                event === "release" ||
                event === "announcements" ||
                event === "mobile-update")
            )
              try {
                receive(event, data.join("\n"));
              } catch {
                /* Invalid events cannot create an update requirement. */
              }
          }
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
    } catch {
      /* Stay usable offline and reconnect with backoff. */
    } finally {
      clock.clear(idle);
      if (active === abort) active = undefined;
      abort.abort();
    }
    if (!stopped && revision === generation) {
      failures = clock.now() - started >= 60000 ? 0 : failures + 1;
      timer = clock.set(() => void connect(), retry);
    }
  };
  void connect();
  const stop = () => {
    stopped = true;
    ++generation;
    clock.clear(timer);
    active?.abort();
  };
  stop.reconnect = () => {
    if (stopped || clock.now() - lastReconnect < 15000) return;
    lastReconnect = clock.now();
    ++generation;
    clock.clear(timer);
    active?.abort();
    failures = 0;
    void connect();
  };
  return stop;
}
