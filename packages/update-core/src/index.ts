import { createHash, sign, verify } from "node:crypto";
import {
  desktopManifestSchema,
  desktopPolicySchema,
  type DesktopRuntime,
  type DesktopManifest,
  type DesktopPolicy,
} from "@cinegather/contracts";
export const digest = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");
export function signDocument(value: unknown, key: string) {
  const payload = JSON.stringify(value);
  return JSON.stringify({
    payload,
    signature: sign(null, Buffer.from(payload), key).toString("base64"),
  });
}
export function verifyDocument(
  raw: string,
  key: string,
  kind: "manifest",
  identity: DesktopRuntime,
): DesktopManifest;
export function verifyDocument(
  raw: string,
  key: string,
  kind: "policy",
  identity: DesktopRuntime,
): DesktopPolicy;
export function verifyDocument(
  raw: string,
  key: string,
  kind: "manifest" | "policy",
  identity: DesktopRuntime,
): DesktopManifest | DesktopPolicy {
  if (Buffer.byteLength(raw) > 256 * 1024) throw new Error("更新清单过大");
  const envelope = JSON.parse(raw);
  if (
    typeof envelope.payload !== "string" ||
    typeof envelope.signature !== "string" ||
    !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature) ||
    !verify(
      null,
      Buffer.from(envelope.payload),
      key,
      Buffer.from(envelope.signature, "base64"),
    )
  )
    throw new Error("资源更新签名无效");
  const value = (
    kind === "manifest" ? desktopManifestSchema : desktopPolicySchema
  ).parse(JSON.parse(envelope.payload));
  if (
    value.runtime !== identity.runtime ||
    value.platform !== identity.platform ||
    value.arch !== identity.arch
  )
    throw new Error("资源更新与原生运行时不匹配");
  return value;
}
export * from "./publication";
export { desktopUpdatePublicKey } from "./public-key";
export { runtimeTree } from "./runtime";
