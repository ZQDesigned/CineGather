import { test, expect } from "bun:test";
import { requirePartySelection } from "../src/modules/party/party-categories";
import type { PartyCatalog } from "@cinegather/contracts";
const root = crypto.randomUUID(),
  child = crypto.randomUUID(),
  off = crypto.randomUUID();
const catalog: PartyCatalog = {
  policy: {
    version: 1,
    draw: { minQuestions: 20, minCategories: 0 },
    quiz: { minQuestions: 20, minCategories: 0 },
  },
  categories: [
    {
      id: root,
      parentId: null,
      name: "游戏",
      enabled: true,
      sortOrder: 0,
      version: 1,
      drawCount: 2,
      quizCount: 2,
    },
    {
      id: child,
      parentId: root,
      name: "明日方舟",
      enabled: true,
      sortOrder: 0,
      version: 1,
      drawCount: 23,
      quizCount: 35,
    },
    {
      id: off,
      parentId: null,
      name: "停用分类",
      enabled: false,
      sortOrder: 0,
      version: 1,
      drawCount: 20,
      quizCount: 20,
    },
  ],
};
test("a single applicable category can start but configured minimum categories still applies", () => {
  expect(requirePartySelection(catalog, [child], "draw").questionCount).toBe(
    23,
  );
  expect(() =>
    requirePartySelection(
      {
        ...catalog,
        policy: {
          ...catalog.policy,
          draw: { minQuestions: 20, minCategories: 2 },
        },
      },
      [child],
      "draw",
    ),
  ).toThrow("2 个分类");
  expect(() => requirePartySelection(catalog, [root], "draw")).toThrow(
    "至少需要 20 道题",
  );
});
test("a category disabled after preview requires explicit confirmation even when remaining questions suffice", () => {
  expect(() => requirePartySelection(catalog, [child, off], "draw")).toThrow(
    "重新选择",
  );
});
