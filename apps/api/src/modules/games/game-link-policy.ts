/** Cleanup is always allowed even when an update blocks other operations. */
export function gameCleanupRequest(method: string, path: string) {
  return (
    (method === "POST" &&
      /^\/api\/v1\/games\/[^/]+\/(?:leave|end)$/.test(path)) ||
    (method === "DELETE" &&
      /^\/api\/v1\/games\/(?:requests|invitations)\/[^/]+$/.test(path))
  );
}
