import { expect, test } from "bun:test";
import type { RoomInvitation } from "@cinegather/contracts";
import { ApprovedRoomEntry } from "../src/renderer/approved-room-entry";

const requestId = "00000000-0000-4000-8000-000000000001";
const approval: RoomInvitation = {
  id: "00000000-0000-4000-8000-000000000002",
  roomId: "00000000-0000-4000-8000-000000000003",
  senderId: "00000000-0000-4000-8000-000000000004",
  senderName: "好友",
  roomName: "好友的房间",
  token: "a".repeat(64),
  expiresAt: "2099-01-01T00:00:00Z",
  requestApproved: true,
  requestId,
};
function fixture() {
  let identity: string | undefined = "server/alice";
  let ready = true,
    saved: string | null = null;
  const joins: RoomInvitation[] = [],
    errors: unknown[] = [];
  let join: (invitation: RoomInvitation) => Promise<void> = async (
    invitation,
  ) => {
    joins.push(invitation);
  };
  const deps = {
    identity: () => identity,
    ready: () => ready,
    load: () => saved,
    save: (value: string | null) => {
      saved = value;
    },
    join: (invitation: RoomInvitation) => join(invitation),
    error: (error: unknown) => {
      errors.push(error);
    },
  };
  const entry = new ApprovedRoomEntry(deps);
  return {
    deps,
    entry,
    joins,
    errors,
    remember: (id = requestId, expiresAt = approval.expiresAt) =>
      entry.remember({ id, expiresAt }),
    identity: (value?: string) => {
      identity = value;
    },
    ready: (value: boolean) => {
      ready = value;
    },
    join: (value: typeof join) => {
      join = value;
    },
    saved: () => saved,
  };
}
test("approval automatically enters once and consumes persisted intent before connecting", async () => {
  const f = fixture();
  f.remember();
  f.join(async (invitation) => {
    expect(f.saved()).toBeNull();
    f.joins.push(invitation);
  });
  await f.entry.sync([approval]);
  await f.entry.sync([approval]);
  expect(f.joins).toEqual([approval]);
  expect(f.saved()).toBeNull();
});
test("ordinary invitations, other requests and other devices require manual acceptance", async () => {
  const f = fixture();
  await f.entry.sync([approval]);
  expect(f.joins).toEqual([]);
  f.remember();
  await f.entry.sync([
    { ...approval, requestApproved: false },
    { ...approval, requestId: undefined },
    { ...approval, requestId: approval.id },
  ]);
  expect(f.joins).toEqual([]);
  await f.entry.sync([approval]);
  expect(f.joins).toEqual([approval]);
});
test("busy operations defer approval and repeated refreshes cannot start concurrent joins", async () => {
  const f = fixture();
  f.remember();
  f.ready(false);
  await f.entry.sync([approval]);
  expect(f.joins).toEqual([]);
  f.ready(true);
  let complete!: () => void;
  f.join(async (invitation) => {
    f.joins.push(invitation);
    await new Promise<void>((resolve) => {
      complete = resolve;
    });
  });
  const joining = f.entry.sync([approval]);
  await f.entry.sync([approval]);
  expect(f.joins).toEqual([approval]);
  complete();
  await joining;
});
test("reload restores intent, but another account cannot consume it", async () => {
  const f = fixture();
  f.remember();
  f.identity("server/bob");
  await new ApprovedRoomEntry(f.deps).sync([approval]);
  expect(f.joins).toEqual([]);
  f.identity("server/alice");
  await new ApprovedRoomEntry(f.deps).sync([approval]);
  expect(f.joins).toEqual([approval]);
});
test("logout, expiry and a newer application revoke previous automatic-entry intent", async () => {
  const f = fixture();
  f.remember();
  f.entry.clear();
  await f.entry.sync([approval]);
  expect(f.joins).toEqual([]);
  f.remember(requestId, "2000-01-01T00:00:00Z");
  await f.entry.sync([approval]);
  expect(f.joins).toEqual([]);
  expect(f.saved()).toBeNull();
  f.remember();
  f.remember(approval.id);
  await f.entry.sync([approval]);
  expect(f.joins).toEqual([]);
  await f.entry.sync([{ ...approval, requestId: approval.id }]);
  expect(f.joins).toHaveLength(1);
});
test("failed entry reports once and preserves manual recovery without an auto-join loop", async () => {
  const f = fixture();
  f.remember();
  const error = Error("房间已满，无法加入");
  f.join(async () => {
    throw error;
  });
  await f.entry.sync([approval]);
  await f.entry.sync([approval]);
  expect(f.errors).toEqual([error]);
  expect(f.saved()).toBeNull();
});
test("storage denial does not prevent the current window from applying and entering", async () => {
  const f = fixture();
  const entry = new ApprovedRoomEntry({
    ...f.deps,
    load: () => {
      throw Error("denied");
    },
    save: () => {
      throw Error("denied");
    },
  });
  entry.remember({ id: requestId, expiresAt: approval.expiresAt });
  await entry.sync([approval]);
  expect(f.joins).toEqual([approval]);
});

test("approval near request expiry remains usable during its admission grace period", async () => {
  const f = fixture();
  f.remember(requestId, new Date(Date.now() - 1000).toISOString());
  await f.entry.sync([]);
  await f.entry.sync([approval]);
  expect(f.joins).toEqual([approval]);
});

test("a late entry failure after logout cannot notify the next account", async () => {
  const f = fixture();
  f.remember();
  let fail!: (error: unknown) => void;
  f.join(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
  );
  const joining = f.entry.sync([approval]);
  f.entry.clear();
  f.identity("server/bob");
  fail(Error("old network failure"));
  await joining;
  expect(f.errors).toEqual([]);
});
