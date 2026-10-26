export * from "./chat";
export * from "./update-events";
export * from "./room";
export * from "./share";
export function parseInvitation(value: string): {
  roomId: string;
  inviteToken?: string;
} {
  const input = value.trim();
  try {
    const url = new URL(input);
    if (!["cinegather:", "https:", "http:"].includes(url.protocol))
      throw new Error("unsupported");
    const roomId = url.searchParams.get("room");
    const inviteToken =
      new URLSearchParams(url.hash.slice(1)).get("invite") ??
      url.searchParams.get("invite") ??
      undefined;
    if (!roomId) throw new Error("missing");
    return { roomId, inviteToken };
  } catch {
    const [roomId = "", inviteToken] = input.split("/");
    return { roomId, inviteToken };
  }
}
