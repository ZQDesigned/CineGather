import type { WebSocket } from "ws";

// Protocol control frames keep idle proxy/CDN connections alive without
// requiring new application messages or JavaScript timers in older clients.
export function startActivityHeartbeat(socket: WebSocket, intervalMs = 20_000) {
  let waitingForPong = false,
    stopped = false;
  const pong = () => {
    waitingForPong = false;
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    socket.off("pong", pong);
    socket.off("close", stop);
  };
  const timer = setInterval(() => {
    if (socket.readyState !== 1) return;
    if (waitingForPong) {
      stop();
      socket.terminate();
      return;
    }
    waitingForPong = true;
    try {
      socket.ping();
    } catch {
      stop();
      socket.terminate();
    }
  }, intervalMs);
  timer.unref();
  socket.on("pong", pong);
  socket.once("close", stop);
  return stop;
}
