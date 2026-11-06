import { expect, test } from "bun:test";
import { parsePartyImport } from "../src/party-bank-import";
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
