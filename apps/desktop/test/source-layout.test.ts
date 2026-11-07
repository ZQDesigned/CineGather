import { expect, test } from "bun:test";
import { inspectSourceLayout } from "../../../tools/checks/source-layout";

test("business modules live in domains while application entry points stay stable", () => {
  const issues = inspectSourceLayout(
    new Map([
      ["apps/api/src/app.ts", ""],
      ["apps/api/src/modules/accounts/auth.ts", ""],
      ["apps/desktop/src/main/index.ts", ""],
      ["apps/desktop/src/renderer/controller.ts", ""],
      ["tools/dev.ts", ""],
      ["apps/api/src/new-service.ts", ""],
      ["apps/desktop/src/main/new-service.ts", ""],
      ["apps/desktop/src/renderer/ui/RoomEditor.tsx", ""],
      ["tools/new-build.ts", ""],
    ]),
  );
  expect(issues.map((issue) => issue.file)).toEqual([
    "apps/api/src/new-service.ts",
    "apps/desktop/src/main/new-service.ts",
    "apps/desktop/src/renderer/ui/RoomEditor.tsx",
    "tools/new-build.ts",
  ]);
});

test("shared packages cannot depend on application implementations", () => {
  const issues = inspectSourceLayout(
    new Map([
      [
        "packages/client-core/src/test.ts",
        'export { x } from "../../../apps/api/src/app";',
      ],
      ["apps/api/src/app.ts", "export const x = 1;"],
    ]),
  );
  expect(issues).toHaveLength(1);
  expect(issues[0]!.message).toContain("Shared packages");
});

test("relative worker assets are checked even with bundler query suffixes", () => {
  const files = new Map([
    [
      "apps/desktop/src/renderer/features/audio/noise.ts",
      'import url from "./process-audio.worklet.ts?worker&url";',
    ],
  ]);
  expect(inspectSourceLayout(files)[0]!.message).toContain(
    "Missing relative module",
  );
  files.set(
    "apps/desktop/src/renderer/features/audio/process-audio.worklet.ts",
    "",
  );
  expect(inspectSourceLayout(files)).toEqual([]);
});

test("dynamic, type and re-export references resolve without rejecting package imports", () => {
  expect(
    inspectSourceLayout(
      new Map([
        [
          "apps/api/src/modules/accounts/index.ts",
          'export * from "./auth.js"; type T = import("./auth").T; const m = import("./auth"); import z from "zod";',
        ],
        ["apps/api/src/modules/accounts/auth.ts", ""],
      ]),
    ),
  ).toEqual([]);
});
