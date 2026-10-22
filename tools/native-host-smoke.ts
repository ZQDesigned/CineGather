import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { NativeProtocol } from "../apps/desktop/src/main/native-protocol";
if (process.platform !== "darwin")
  throw new Error("The native capture runtime currently supports macOS arm64.");
const work = await mkdtemp(join(tmpdir(), "cg-native-smoke-"));
const bundle = resolve(
  process.env.CINEGATHER_NATIVE_BUNDLE ??
    "apps/desktop/release/mac-arm64/CineGather.app/Contents/Resources/capture/CineGatherLibobsHost.app",
);
const child = spawn(
  join(bundle, "Contents/MacOS/CineGatherLibobsHost"),
  [work],
  { stdio: "pipe" },
);
const pipe = new NativeProtocol(
  (data) => child.stdin.write(data),
  () => child.kill("SIGKILL"),
);
child.stdout.setEncoding("utf8");
child.stdout.on("data", (data) => pipe.receive(data));
child.stderr.resume();
child.stdin.on("error", () => pipe.close());
child.on("error", () => pipe.close());
child.on("close", () => pipe.close());
type Status = {
  engineReady: boolean;
  screenPermission: boolean;
  outputActive: boolean;
  outputPhase: string;
  sourcesActive: boolean;
  runtimeImages: string[];
  loadedPlugins: string[];
  nativeAllocationCountAfterShutdown?: number;
};
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
async function wait(predicate: () => Promise<boolean>, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Native runtime condition timed out");
}
let server: ReturnType<typeof Bun.serve> | undefined;
const report: Record<string, unknown> = {};
try {
  const initial = await pipe.call<Status>({ type: "status" });
  check(
    initial.engineReady && initial.loadedPlugins.length === 4,
    "Native engine/plugins did not initialize",
  );
  check(
    initial.runtimeImages.every(
      (path) => !path.startsWith("/Applications/OBS.app/"),
    ),
    "Runtime depends on installed OBS paths",
  );
  report.engineReady = true;
  report.bundledRuntime = true;
  if (process.env.CINEGATHER_CAPTURE_TEST === "1") {
    check(
      initial.screenPermission,
      "Grant screen/system audio recording to CineGatherLibobsHost before capture tests",
    );
    const sources = await pipe.call<{
      windows: {
        windowId: number;
        pid: number;
        title: string;
        bundleId: string;
      }[];
      displays: unknown[];
    }>({ type: "windows" });
    const window = sources.windows.find((w) =>
      w.title.includes("CineGather OBS Controlled Source"),
    );
    check(
      window,
      "Open the controlled synthetic test window before capture tests",
    );
    let posts = 0;
    server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => {
        posts++;
        return new Response("invalid test key", { status: 404 });
      },
    });
    const config = {
      windowId: window.windowId,
      pid: window.pid,
      application: window.bundleId,
      quality: "saver",
      systemAudio: true,
      server: `http://127.0.0.1:${server.port}/whip`,
      token: "disposable-invalid-test-key",
      remainingMs: 30_000,
    };
    let rejected = false;
    try {
      await pipe.call({ type: "start", ...config, pid: window.pid + 1 });
    } catch {
      rejected = true;
    }
    check(rejected, "Stale process ID was accepted");
    await pipe.call({ type: "start", ...config });
    await wait(
      async () =>
        posts > 0 &&
        (await pipe.call<Status>({ type: "status" })).outputPhase === "failed",
    );
    rejected = false;
    try {
      await pipe.call({ type: "start", ...config });
    } catch {
      rejected = true;
    }
    check(
      rejected && (await pipe.call<Status>({ type: "status" })).sourcesActive,
      "Duplicate start changed an existing capture",
    );
    const stopAt = performance.now();
    const stopped = await pipe.call<Status>({ type: "stop" });
    check(
      !stopped.sourcesActive && !stopped.outputActive,
      "Failed WHIP output retained capture resources",
    );
    report.failedHandshakeStopMs = performance.now() - stopAt;
    const deadlineAt = performance.now();
    await pipe.call({ type: "start", ...config, remainingMs: 3000 });
    await wait(
      async () => !(await pipe.call<Status>({ type: "status" })).sourcesActive,
    );
    report.deadlineStopMs = performance.now() - deadlineAt;
    const previousPosts = posts;
    await pipe.call({ type: "start", ...config, systemAudio: false });
    await wait(async () => posts > previousPosts);
    await pipe.call({ type: "stop" });
    report.videoOnlyWhipHandshake = true;
    report.rejectedStalePid = true;
    report.rejectedDuplicateStart = true;
    report.httpPosts = posts;
    report.displayCount = sources.displays.length;
  }
  const stopped = await pipe.call<{
    nativeAllocationCountAfterShutdown: number;
  }>({ type: "shutdown" });
  check(
    stopped.nativeAllocationCountAfterShutdown === 0,
    "libobs retained tracked allocations at shutdown",
  );
  report.nativeAllocationsAfterShutdown = 0;
  console.log(JSON.stringify(report, null, 2));
} finally {
  child.kill("SIGKILL");
  server?.stop(true);
  await rm(work, { recursive: true, force: true });
}
