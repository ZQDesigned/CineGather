import type { ShareLease } from "@cinegather/contracts";
import { fail } from "./errors";
export { nativeIdentity, nativeOwner } from "@cinegather/contracts";
export function requireNativeLease(
  lease:
    | {
        holderUserId: string | null;
        leaseId: string | null;
        revision: number;
        expiresAt: Date | null;
      }
    | null
    | undefined,
  userId: string,
  input: Pick<ShareLease, "leaseId" | "revision">,
  connected: boolean,
  now = Date.now(),
) {
  if (
    !lease ||
    lease.holderUserId !== userId ||
    lease.leaseId !== input.leaseId ||
    lease.revision !== input.revision ||
    !lease.expiresAt ||
    lease.expiresAt.getTime() <= now
  )
    fail(409, "LEASE_LOST", "共享授权已失效，请重新共享");
  if (!connected) fail(409, "MEDIA_NOT_CONNECTED", "请先连接房间语音");
}
