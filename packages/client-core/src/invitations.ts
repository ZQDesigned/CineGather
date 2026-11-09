const stripPunctuation = (value: string) =>
  value.replace(/[。！？；，、）】》」.,;!?)}\]]+$/u, "");

function parseUrl(
  value: string,
): { roomId: string; inviteToken?: string } | undefined {
  try {
    const url = new URL(stripPunctuation(value));
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    const roomId = url.searchParams.get("room");
    if (!roomId) return;
    const inviteToken =
      new URLSearchParams(url.hash.slice(1)).get("invite") ??
      url.searchParams.get("invite") ??
      undefined;
    return { roomId, inviteToken };
  } catch {
    return;
  }
}

export function isRoomInvitationUrl(value: string) {
  return value.length <= 4096 && !/\s/u.test(value) && Boolean(parseUrl(value));
}

export function createRoomInvitationLink(
  base: string,
  roomId: string,
  token: string,
) {
  const url = new URL(base);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("邀请需要使用有效的网页地址");
  url.search = "";
  url.searchParams.set("room", roomId);
  url.hash = new URLSearchParams({ invite: token }).toString();
  return url.href;
}

export function formatRoomInvitation({
  inviterName,
  roomName,
  roomCode,
  link,
}: {
  inviterName: string;
  roomName: string;
  roomCode: string;
  link: string;
}) {
  const line = (value: string) => {
    // eslint-disable-next-line no-control-regex -- User names must not inject control characters or extra invitation lines.
    return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();
  };
  return `${line(inviterName) || "映聚用户"} 邀请你加入映聚\n房间：${line(roomName) || "未命名房间"}\n房间号：${line(roomCode)}\n加入链接：${link}`;
}

export function parseInvitation(value: string): {
  roomId: string;
  inviteToken?: string;
} {
  const input = value.trim();
  const direct = /\s/u.test(input) ? undefined : parseUrl(input);
  if (direct) return direct;
  // Prefer the explicit final link line over URLs contained in names or download instructions.
  const labeled = [
    ...input.matchAll(
      /^(?:加入链接|加入房间|邀请链接)[：:]\s*(https?:\/\/\S+)/gmu,
    ),
  ].reverse();
  const links = [
    ...input.matchAll(/https?:\/\/[^\s<>"'「」【】]+/giu),
  ].reverse();
  for (const candidate of [
    ...labeled.map((m) => m[1]!),
    ...links.map((m) => m[0]),
  ]) {
    const parsed = parseUrl(candidate);
    if (parsed) return parsed;
  }
  return { roomId: /^[^\s/:]+$/u.test(input) ? input : "" };
}
