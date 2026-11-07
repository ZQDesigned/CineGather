import { createServer } from "node:net";
const command =
  process.argv[2] === "node"
    ? ["node", "apps/api/dist/main.js"]
    : ["bun", "apps/api/src/main.ts"];
const socket = createServer();
await new Promise<void>((resolve) => {
  socket.listen(0, "127.0.0.1", resolve);
});
const address = socket.address();
if (!address || typeof address === "string")
  throw new Error("Could not reserve test port");
const port = address.port;
await new Promise<void>((resolve, reject) =>
  socket.close((error) => (error ? reject(error) : resolve())),
);
const child = Bun.spawn(command, {
  env: { ...process.env, API_PORT: String(port) },
  stdout: "pipe",
  stderr: "pipe",
});
let ready = false;
try {
  for (let n = 0; n < 50; n++) {
    if (child.exitCode !== null)
      throw new Error("Runtime exited before becoming healthy");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Child is still starting. */
    }
    await Bun.sleep(100);
  }
  if (!ready) throw new Error("Health timeout");
  child.kill("SIGTERM");
  const result = await Promise.race([
    child.exited,
    Bun.sleep(5000).then(() => "timeout"),
  ]);
  if (result !== 0) throw new Error(`Graceful shutdown returned ${result}`);
  console.log(`${command[0]} runtime: health and graceful shutdown passed.`);
} catch (error) {
  child.kill("SIGKILL");
  console.error(await new Response(child.stderr).text());
  throw error;
}

export {};
