import { expect, test } from "bun:test";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { probeStardewWorld } from "../src/main/stardew-worlds";
test("Stardew probing reports a local occupied UDP service without fabricating a Minecraft protocol or game version", async () => {
  const socket = createSocket("udp4");
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  const port = socket.address().port;
  try {
    const world = await probeStardewWorld(port);
    expect(world).toEqual({
      game: "stardew-valley",
      port,
      name: "本机农场",
      version: "",
      transport: "tcp-udp",
    });
  } finally {
    socket.close();
  }
  await new Promise((r) => setTimeout(r, 10));
  await expect(probeStardewWorld(port)).rejects.toThrow("联机");
});
