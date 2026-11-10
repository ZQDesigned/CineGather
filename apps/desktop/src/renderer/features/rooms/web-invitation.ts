import { parseInvitation } from "@cinegather/client-core/invitations";
export function readWebInvitation(
  href: string,
  replace: (clean: string) => void,
): string | undefined {
  const url = new URL(href);
  if (!url.searchParams.has("room")) return;
  const invitation = parseInvitation(href);
  if (!invitation.roomId) return;
  url.searchParams.delete("room");
  url.searchParams.delete("invite");
  const hash = new URLSearchParams(url.hash.slice(1));
  hash.delete("invite");
  url.hash = hash.toString();
  replace(url.href);
  return href;
}

let captured: string | undefined;
// Run before asynchronous UI bootstrap so private tokens never wait for a lazy chunk.
export function captureWebInvitation(
  href: string,
  replace: (clean: string) => void,
) {
  captured = readWebInvitation(href, replace);
}
export function takeCapturedWebInvitation() {
  const value = captured;
  captured = undefined;
  return value;
}
