import { registrationDefault } from "./registration-config";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) loadEnvFile(envFile);
function required(name: string, min = 1) {
  const value = process.env[name];
  if (!value || value.length < min || value.includes("REPLACE_ME"))
    throw new Error(`${name} must be configured`);
  return value;
}
export const config = {
  registrationEnabled: registrationDefault(process.env.REGISTRATION_ENABLED),
  databaseUrl: required("DATABASE_URL"),
  sessionSecret: required("SESSION_SECRET", 32),
  livekitKey: required("LIVEKIT_API_KEY"),
  livekitSecret: required("LIVEKIT_API_SECRET", 32),
  livekitUrl: required("LIVEKIT_URL"),
  livekitInternalUrl: required("LIVEKIT_INTERNAL_URL"),
  port: Number(process.env.API_PORT ?? 14310),
  host: process.env.API_HOST ?? "127.0.0.1",
  corsOrigins: (process.env.CORS_ORIGINS ?? "").split(",").filter(Boolean),
  trustedProxies: (process.env.TRUST_PROXY ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
};
