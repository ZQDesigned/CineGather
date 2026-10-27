import { z } from "zod";
const uuid = z.uuid().toLowerCase();
const pattern = /^cinegather\/member\/v1\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/;
export function memberIdentity(userId: string, credentialId: string) {
  return `cinegather/member/v1/${uuid.parse(userId)}/${uuid.parse(credentialId)}`;
}
function parts(identity: string) {
  const match = pattern.exec(identity);
  if (
    !match ||
    !uuid.safeParse(match[1]).success ||
    !uuid.safeParse(match[2]).success
  )
    return;
  return { userId: match[1]!, credentialId: match[2]! };
}
export const memberOwner = (identity: string) => parts(identity)?.userId;
export const memberSession = (identity: string) =>
  parts(identity)?.credentialId;
// Native publishers are deliberately handled by nativeOwner at call sites.
export function participantOwner(identity: string) {
  const member = memberOwner(identity);
  if (member) return member;
  const legacy = uuid.safeParse(identity);
  return legacy.success ? legacy.data : undefined;
}
