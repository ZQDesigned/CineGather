import { createApp, closeDatabase, openapi } from "./app";
import { config } from "./config";
import { SwaggerModule } from "@nestjs/swagger";
const app = await createApp();
if (process.env.NODE_ENV !== "production")
  SwaggerModule.setup("api/docs", app, openapi(app));
await app.listen(config.port, config.host);
console.log(
  JSON.stringify({ event: "api.ready", host: config.host, port: config.port }),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    await closeDatabase();
    process.exit(0);
  });
