import { expect, test } from "bun:test";
import type { User } from "@cinegather/contracts";
import { MobileSession } from "../src/mobile-session";

const user = (displayName: string): User => ({
  id: "01234567-1234-4234-8234-012345678901",
  displayName,
});
const credential = (token: string) => ({
  user: user(token),
  sessionToken: token,
  expiresAt: "2030-01-01T00:00:00.000Z",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("late login cannot replace the newer mobile account or persist its token", async () => {
  let stored: string | undefined;
  const revoked: string[] = [];
  const old = deferred<ReturnType<typeof credential>>();
  const session = new MobileSession({
    storage: {
      read: async () => stored,
      write: async (token) => {
        stored = token;
      },
      clear: async () => {
        stored = undefined;
      },
    },
    profile: async () => user("restored"),
    revoke: async (token) => {
      revoked.push(token);
    },
  });
  const pending = session.authenticate(() => old.promise);
  expect(await session.authenticate(async () => credential("new"))).toBe(true);
  old.resolve(credential("old"));
  expect(await pending).toBe(false);
  expect(session.snapshot().user?.displayName).toBe("new");
  expect(session.getToken()).toBe("new");
  expect(stored).toBe("new");
  expect(revoked).toEqual(["old"]);
  expect(JSON.stringify(session.snapshot())).not.toContain("sessionToken");
});

test("a secure-store write already in flight cannot overwrite logout and a subsequent login", async () => {
  let stored: string | undefined;
  const began = deferred<void>(),
    release = deferred<void>();
  const session = new MobileSession({
    storage: {
      read: async () => stored,
      write: async (token) => {
        if (token === "old") {
          began.resolve();
          await release.promise;
        }
        stored = token;
      },
      clear: async () => {
        stored = undefined;
      },
    },
    profile: async () => user("unused"),
    revoke: async () => {},
  });
  const first = session.authenticate(async () => credential("old"));
  await began.promise;
  const leaving = session.signOut();
  const second = session.authenticate(async () => credential("new"));
  release.resolve();
  await Promise.all([first, leaving, second]);
  expect(stored).toBe("new");
  expect(session.snapshot().user?.displayName).toBe("new");
  expect(await session.invalidate("old")).toBe(false);
  expect(stored).toBe("new");
});

test("temporary restore failure preserves credentials while an authoritative401 removes them", async () => {
  let stored: string | undefined = "saved";
  let unauthorized = false;
  const session = new MobileSession({
    storage: {
      read: async () => stored,
      write: async (token) => {
        stored = token;
      },
      clear: async () => {
        stored = undefined;
      },
    },
    profile: async () => {
      throw unauthorized
        ? Object.assign(new Error("expired"), { status: 401 })
        : new Error("offline");
    },
    revoke: async () => {},
  });
  expect(await session.restore()).toBe(false);
  expect(stored).toBe("saved");
  expect(session.snapshot().canRetryRestore).toBe(true);
  unauthorized = true;
  expect(await session.restore()).toBe(false);
  expect(stored).toBeUndefined();
  expect(session.snapshot().status).toBe("signed-out");
  expect(session.snapshot().canRetryRestore).toBe(false);
});

test("secure-store deletion failure does not leave the server session active after logout", async () => {
  const revoked: string[] = [];
  const session = new MobileSession({
    storage: {
      read: async () => undefined,
      write: async () => {},
      clear: async () => {
        throw new Error("store locked");
      },
    },
    profile: async () => user("unused"),
    revoke: async (token) => {
      revoked.push(token);
    },
  });
  await session.authenticate(async () => credential("active"));
  await expect(session.signOut()).rejects.toThrow("store locked");
  expect(session.getToken()).toBeUndefined();
  expect(revoked).toEqual(["active"]);
});
