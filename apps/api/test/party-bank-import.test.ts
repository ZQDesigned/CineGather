import { expect, test } from "bun:test";
import { parsePartyImport } from "../src/modules/party/party-bank-import";
const item = {
  answer: "雨伞",
  category: "用品",
  clues: ["能收拢", "用于雨天", "撑开遮雨"],
  enabled: true,
};
test("import rejects invalid rows and normalized duplicate answers", () => {
  expect(
    parsePartyImport({
      format: "json",
      content: JSON.stringify([item, { ...item, answer: "雨 伞" }]),
    }).errors,
  ).toHaveLength(1);
  expect(
    parsePartyImport({
      format: "json",
      content: JSON.stringify([{ ...item, clues: ["只有一条"] }]),
    }).errors,
  ).toHaveLength(1);
  expect(
    parsePartyImport({
      format: "json",
      content: JSON.stringify(Array(501).fill(item)),
    }).errors,
  ).toHaveLength(1);
});
test("CSV accepts BOM quoted commas/newlines and validates booleans", () => {
  const content =
    '\uFEFFanswer,category,clue1,clue2,clue3,enabled\r\n雨伞,用品,"可以,收拢","雨天\n使用","撑开""遮雨",true\r\n';
  const result = parsePartyImport({ format: "csv", content });
  expect(result.errors).toEqual([]);
  expect(result.items[0]!.clues).toEqual([
    "可以,收拢",
    "雨天\n使用",
    '撑开"遮雨',
  ]);
  expect(
    parsePartyImport({
      format: "csv",
      content: content.replace(",true", ",yes"),
    }).errors.length,
  ).toBe(1);
  expect(
    parsePartyImport({ format: "csv", content: content + '"broken' }).errors
      .length,
  ).toBe(1);
});
test("question modes accept drawing, guessing or both, and preserve legacy imports", () => {
  const parse = (modes: unknown) =>
    parsePartyImport({
      format: "json",
      content: JSON.stringify([{ ...item, modes }]),
    });
  expect(parse(["draw"]).items[0]?.modes).toEqual(["draw"]);
  expect(parse(["quiz"]).errors).toEqual([]);
  expect(parse(["draw", "quiz"]).errors).toEqual([]);
  expect(parse([]).errors).toHaveLength(1);
  expect(parse(["draw", "draw"]).errors).toHaveLength(1);
  expect(parse(["unknown"]).errors).toHaveLength(1);
  expect(
    parsePartyImport({
      format: "csv",
      content:
        "answer,category,clue1,clue2,clue3,enabled,modes\n雨伞,用品,能收拢,用于雨天,撑开遮雨,true,draw|quiz",
    }).items[0]?.modes,
  ).toEqual(["draw", "quiz"]);
});
test("hierarchical CSV accepts parent categories and blank optional children", () => {
  const result = parsePartyImport({
    format: "csv",
    content:
      "answer,parentCategory,category,clue1,clue2,clue3,enabled,modes\n阿米娅,游戏,明日方舟,一,二,三,true,draw|quiz\n刻舟求剑,,成语典故,一,二,三,true,quiz",
  });
  expect(result.errors).toEqual([]);
  expect(result.items[0]).toMatchObject({
    parentCategory: "游戏",
    category: "明日方舟",
  });
  expect(result.items[1]?.category).toBe("成语典故");
});
