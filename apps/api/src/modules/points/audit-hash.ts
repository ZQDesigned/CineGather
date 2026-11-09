import { createHash } from "node:crypto";
function canonical(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`)
      .join(",")}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    throw Error("Non-JSON value in accounting evidence");
  return encoded;
}
export function pointsEntryHash(row: Record<string, unknown>) {
  // Empty optional metadata has one canonical representation.
  const { facts, ...base } = row;
  const payload =
    facts && typeof facts === "object" && Object.keys(facts).length
      ? row
      : base;
  return createHash("sha256").update(canonical(payload)).digest("hex");
}
