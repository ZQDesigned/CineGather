import { test, expect } from "bun:test";
import {
  partyCategoryStats,
  partyCategoryInput,
  partyPolicyInput,
} from "../src/party-categories";
const category = (
  id: string,
  parentId: string | null,
  drawCount: number,
  quizCount = drawCount,
  enabled = true,
) => ({
  id,
  parentId,
  name: id,
  enabled,
  sortOrder: 0,
  version: 1,
  drawCount,
  quizCount,
});
test("counts direct parent questions and children once, ignoring zero-question and disabled branches", () => {
  const categories = [
    category("root", null, 4),
    category("a", "root", 23, 35),
    category("b", "root", 2, 15),
    category("empty", null, 0),
    category("off", null, 50, 50, false),
    category("hidden", "off", 10),
  ];
  expect(
    partyCategoryStats(
      categories,
      ["root", "a", "a", "b", "empty", "off", "hidden"],
      "draw",
    ),
  ).toEqual({
    questionCount: 29,
    categoryCount: 3,
    categoryIds: ["root", "a", "b"],
  });
  expect(partyCategoryStats(categories, ["a"], "quiz").questionCount).toBe(35);
  expect(partyCategoryStats(categories, [], "draw").questionCount).toBe(0);
});
test("secondary category is optional and policies have safe hard limits", () => {
  expect(
    partyCategoryInput.parse({
      name: "成语",
      parentId: null,
      enabled: true,
      sortOrder: 0,
    }).parentId,
  ).toBeNull();
  expect(
    partyPolicyInput.safeParse({
      version: 1,
      draw: { minQuestions: 5, minCategories: 0 },
      quiz: { minQuestions: 20, minCategories: 0 },
    }).success,
  ).toBe(false);
  expect(
    partyPolicyInput.safeParse({
      version: 1,
      draw: { minQuestions: 20, minCategories: 0 },
      quiz: { minQuestions: 20, minCategories: 1 },
    }).success,
  ).toBe(true);
});
