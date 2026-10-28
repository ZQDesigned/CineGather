import { z } from "zod";
export const watchProfileSchema = z.enum(["smooth", "balanced", "low-latency"]);
export type WatchProfile = z.infer<typeof watchProfileSchema>;
export const watchProfiles = {
  smooth: { label: "流畅", targetMs: 350 },
  balanced: { label: "均衡", targetMs: 150 },
  "low-latency": { label: "低延迟", targetMs: 0 },
} as const;
