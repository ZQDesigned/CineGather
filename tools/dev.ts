const children = [
  Bun.spawn(["bun", "run", "dev:api"], {
    stdout: "inherit",
    stderr: "inherit",
  }),
  Bun.spawn(["bun", "run", "dev:desktop"], {
    stdout: "inherit",
    stderr: "inherit",
  }),
];
let ending = false;
const stop = () => {
  if (ending) return;
  ending = true;
  for (const child of children) child.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await Promise.race(children.map((child) => child.exited));
stop();
await Promise.all(children.map((child) => child.exited));

export {};
