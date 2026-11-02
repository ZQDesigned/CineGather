import { createServer } from "node:http";
import express from "express";
import { attachEsportsGateway } from "./esports-gateway";
export function startEsportsDevGateway(options: {
  port: number;
  apiUrl: string;
  upstreamUrl: string;
  secret: string;
}) {
  const app = express(),
    server = createServer(app);
  const gateway = attachEsportsGateway(server, options.upstreamUrl);
  app.use(gateway.middleware);
  app.use((_req, res) => {
    res.status(404).end();
  });
  server.listen(options.port, "127.0.0.1");
  return {
    stop(_force?: boolean) {
      gateway.close();
      server.closeAllConnections();
      server.close();
    },
  };
}
