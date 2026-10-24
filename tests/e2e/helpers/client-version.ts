import { version } from "../../../apps/desktop/package.json";
export const currentClientVersion = version;
const parts = version.split(".");
parts[2] = String(Number(parts[2]) + 1);
export const nextClientVersion = parts.join(".");
