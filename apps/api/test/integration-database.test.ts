import { expect, test } from "bun:test";
import { isolatedIntegrationUrl } from "../../../tools/validation/integration";

test("integration runner uses a new database while preserving local connection settings", () => {
  const original =
    "postgres://dev:p%40ss@127.0.0.1:55432/cinegather?sslmode=disable";
  const target = isolatedIntegrationUrl(original);
  expect(target.pathname).toMatch(
    /^\/cinegather_activities_tests_esports_[a-f0-9]{12}$/,
  );
  expect(target.username).toBe("dev");
  expect(target.password).toBe("p%40ss");
  expect(target.port).toBe("55432");
  expect(target.search).toBe("?sslmode=disable");
  expect(new URL(original).pathname).toBe("/cinegather");
  expect(isolatedIntegrationUrl(original).pathname).not.toBe(target.pathname);
});

test("integration runner rejects remote databases before connecting", () => {
  expect(() =>
    isolatedIntegrationUrl("postgres://dev:private@db.example.com/live"),
  ).toThrow("local PostgreSQL");
  expect(() => isolatedIntegrationUrl("https://localhost/live")).toThrow(
    "PostgreSQL URL",
  );
  expect(
    isolatedIntegrationUrl("postgresql://dev@localhost/dev").hostname,
  ).toBe("localhost");
  expect(isolatedIntegrationUrl("postgres://dev@[::1]/dev").hostname).toBe(
    "[::1]",
  );
});
