import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import assert from "node:assert/strict";
import { NativeProtocol } from "../apps/desktop/src/main/native-protocol";

const runtime = resolve(process.argv[2]!);
const directory = await mkdtemp(join(tmpdir(), "cg-pion-"));
const receiver = spawn(resolve(".local/pion-whip-smoke.exe"), [], {
  stdio: "pipe",
  windowsHide: true,
});
const child = spawn(
  join(runtime, "bin/64bit/CGScreenCaptureHost.exe"),
  [directory, String(process.pid), "stdio"],
  { stdio: "pipe", windowsHide: true },
);
const pipe = new NativeProtocol(
  (data) => child.stdin.write(data),
  () => child.kill(),
);
child.stdout.setEncoding("utf8");
child.stdout.on("data", (data) => pipe.receive(data));
child.stdin.on("error", () => pipe.close());
child.stderr.setEncoding("utf8");
child.stderr.on("data", (data) => {
  for (const line of String(data).split(/\r?\n/))
    if (/^CG_HOST_(?:ERROR|TRANSPORT) /.test(line)) console.log(line);
});
child.on("error", (error) => pipe.close(error));
child.on("close", (code) => pipe.close(new Error(`host-exit-${code}`)));
receiver.stderr.pipe(process.stderr);
let serverPort: number | undefined;
try {
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("pion-startup-timeout")),
      10000,
    );
    createInterface({ input: receiver.stdout }).once("line", (line) => {
      clearTimeout(timer);
      resolve(JSON.parse(line).port);
    });
    receiver.on("error", reject);
  });
  serverPort = port;
  const transport = spawnSync(
    resolve(".local/native-runtime/windows/build/CGProtocolProbe.exe"),
    [`http://127.0.0.1:${port}/whip`],
    {
      env: {
        ...process.env,
        PATH: join(runtime, "bin/64bit") + delimiter + process.env.PATH,
      },
      encoding: "utf8",
      timeout: 15000,
      windowsHide: true,
    },
  );
  console.log(
    "Isolated bundled RTC transport:",
    JSON.stringify({
      exit: transport.status,
      stdout: transport.stdout,
      stderr: transport.stderr,
    }),
  );
  await pipe.call({ type: "status" });
  const result = await pipe.call<{
    status: string;
    framesEncoded: number;
    encoder: unknown;
  }>({
    type: "probe",
    encoder: "x264",
    server: `http://127.0.0.1:${port}/whip`,
  });
  const received = (await (
    await fetch(`http://127.0.0.1:${port}/stats`)
  ).json()) as { frames: number; packets: number; state: string };
  console.log(
    "Native OBS to LiveKit/Pion protocol regression:",
    JSON.stringify({ result, received }),
  );
  assert.equal(result.status, "ok");
  assert(result.framesEncoded >= 30);
  assert(received.frames >= 30);
} catch (error) {
  if (serverPort)
    console.log(
      "Pion failure state:",
      await (await fetch(`http://127.0.0.1:${serverPort}/stats`)).text(),
    );
  throw error;
} finally {
  child.kill();
  receiver.kill();
  await rm(directory, { recursive: true, force: true });
}
