import { test, expect } from "bun:test";
import {
  adminPermissionKeys,
  protocolHeaders,
  type User,
} from "@cinegather/contracts";
import { z } from "zod";
import {
  presentAccountUser,
  presentAccountSession,
} from "../src/modules/accounts/account-presentation";
test("old clients can still restore privileged sessions without unknown permission enum values", () => {
  const user: User = {
    id: crypto.randomUUID(),
    displayName: "审核员",
    username: "reviewer",
    permissions: [
      "party-words.read",
      "party-submissions.read",
      "party-submissions.review",
    ],
  };
  const legacy = z.array(
    z.enum(
      adminPermissionKeys.filter((p) => !p.startsWith("party-submissions.")),
    ),
  );
  const older = presentAccountUser(user, "esports-v1,esports-v2");
  expect(legacy.safeParse(older.permissions).success).toBe(true);
  expect(older.permissions).toEqual(["party-words.read"]);
  expect(
    presentAccountUser(user, protocolHeaders["X-CineGather-Features"])
      .permissions,
  ).toEqual(user.permissions);
  expect(user.permissions).toHaveLength(3);
  const session = { user, sessionToken: "test", expiresAt: "future" };
  expect(presentAccountSession(session, undefined)).toMatchObject({
    sessionToken: "test",
    user: { permissions: ["party-words.read"] },
  });
});
