import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { fail } from "./errors";
let deriving = 0;
async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (deriving >= 2) fail(429, "AUTH_BUSY", "登录请求较多，请稍后重试");
  deriving++;
  try {
    return await new Promise<Buffer>((resolve, reject) =>
      scrypt(
        password,
        salt,
        32,
        { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 },
        (error, key) => (error ? reject(error) : resolve(key)),
      ),
    );
  } finally {
    deriving--;
  }
}
export async function hashAccountPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt-account-v1$${salt.toString("hex")}$${(await derive(password, salt)).toString("hex")}`;
}
export const dummyAccountHash = `scrypt-account-v1$${"0".repeat(32)}$${"0".repeat(64)}`;
export async function verifyAccountPassword(password: string, encoded: string) {
  const match = /^scrypt-account-v1\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(
    encoded,
  );
  if (!match) return false;
  return timingSafeEqual(
    await derive(password, Buffer.from(match[1]!, "hex")),
    Buffer.from(match[2]!, "hex"),
  );
}
