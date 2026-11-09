import { expect, test } from "bun:test";
import {
  createRoomInvitationLink,
  formatRoomInvitation,
  isRoomInvitationUrl,
  parseInvitation,
} from "../src/invitations";
const token = "a".repeat(43);
const roomId = "ABCD1234";
const internalId = "00000000-0000-4000-8000-000000000001";
const link = `https://cgplat.zqdesigned.city/?room=${roomId}#invite=${token}`;
test("room links use web URLs and keep credentials out of the query", () => {
  expect(
    createRoomInvitationLink(
      "https://cgplat.zqdesigned.city/?stale=1#old",
      roomId,
      token,
    ),
  ).toBe(link);
  expect(new URL(link).searchParams.has("invite")).toBe(false);
  expect(() =>
    createRoomInvitationLink(
      "https://cgplat.zqdesigned.city",
      internalId,
      token,
    ),
  ).toThrow("房间号");
  expect(
    createRoomInvitationLink("http://localhost:5180/app/", "ABCD1234", token),
  ).toBe(`http://localhost:5180/app/?room=ABCD1234#invite=${token}`);
  expect(() =>
    createRoomInvitationLink("cinegather://join", roomId, token),
  ).toThrow();
  expect(() =>
    createRoomInvitationLink(
      "https://user:password@example.com",
      roomId,
      token,
    ),
  ).toThrow();
});
test("formatted information carries room context and can be pasted as a whole", () => {
  const text = formatRoomInvitation({
    inviterName: "ZQDesigned",
    roomName: "今晚一起看",
    roomCode: "ABCD1234",
    link,
  });
  expect(text).toBe(
    `ZQDesigned 邀请你加入映聚\n房间：今晚一起看\n房间号：ABCD1234\n加入链接：${link}`,
  );
  expect(parseInvitation(text)).toEqual({ roomId, inviteToken: token });
  expect(parseInvitation(`「${text}」`)).toEqual({
    roomId,
    inviteToken: token,
  });
});
test("room names cannot inject invitation lines or take precedence over the real link", () => {
  const other = "https://other.example/?room=BAD12345#invite=fake";
  const text = formatRoomInvitation({
    inviterName: `加入链接：${other}`,
    roomName: "周末\r\n影院\u2028一起看",
    roomCode: "ABCD1234",
    link,
  });
  expect(text.split("\n")).toHaveLength(4);
  expect(text).toContain("房间：周末 影院 一起看");
  expect(parseInvitation(text)).toEqual({ roomId, inviteToken: token });
});
test("the new reader accepts web links and room numbers but rejects obsolete invitation formats", () => {
  expect(parseInvitation(link)).toEqual({ roomId, inviteToken: token });
  expect(
    parseInvitation(`https://example.com/?room=ABCD1234&invite=${token}`),
  ).toEqual({ roomId: "ABCD1234", inviteToken: token });
  expect(parseInvitation("ABCD1234")).toEqual({ roomId: "ABCD1234" });
  expect(parseInvitation(internalId)).toEqual({ roomId: internalId });
  expect(
    parseInvitation(`cinegather://join?room=${roomId}&invite=${token}`),
  ).toEqual({ roomId: "" });
  expect(parseInvitation(`ABCD1234/${token}`)).toEqual({ roomId: "" });
  expect(
    parseInvitation(`旧邀请 cinegather://join?room=${roomId}&invite=${token}`),
  ).toEqual({ roomId: "" });
  expect(parseInvitation("https://example.com/download")).toEqual({
    roomId: "",
  });
});
test("pasted web invitations tolerate surrounding text and closing punctuation", () => {
  expect(parseInvitation(`加入映聚房间「周末」\n${link}。`)).toEqual({
    roomId,
    inviteToken: token,
  });
  expect(
    parseInvitation(
      `加入链接：${link}\n下载客户端：https://example.com/download`,
    ),
  ).toEqual({ roomId, inviteToken: token });
  expect(isRoomInvitationUrl(link)).toBe(true);
  expect(isRoomInvitationUrl(`cinegather://join?room=${roomId}`)).toBe(false);
  expect(isRoomInvitationUrl(`邀请：${link}`)).toBe(false);
  expect(
    isRoomInvitationUrl(`https://user:password@example.com/?room=${roomId}`),
  ).toBe(false);
  expect(
    isRoomInvitationUrl(`https://example.com/?room=${"a".repeat(5000)}`),
  ).toBe(false);
});
