import { expect, test } from "bun:test";
import {
  newPartyGame,
  partyCommand,
  partyView,
} from "../src/modules/party/party-game";
test("submitter attribution is visible only with an authorized choice or revealed answer", () => {
  const pool = Array.from({ length: 6 }, (_, i) => ({
    answer: "投稿题" + i,
    category: "用品",
    clues: ["一", "二", "三"],
    author: { displayName: "投稿人" },
  }));
  let game = newPartyGame("draw", pool);
  for (const id of ["a", "b"])
    game = partyCommand(
      game,
      { id, name: id },
      { type: "ready", ready: true },
      10000,
    );
  game = partyCommand(game, { id: "a", name: "a" }, { type: "start" }, 10000);
  const drawer = game.drawerId!,
    guest = drawer === "a" ? "b" : "a";
  expect(partyView(game, drawer, 10001).choiceAuthors).toEqual(
    Array.from({ length: 3 }, () => ({ displayName: "投稿人" })),
  );
  expect(partyView(game, guest, 10001).choiceAuthors).toBeUndefined();
  game = partyCommand(
    game,
    { id: drawer, name: drawer },
    { type: "choose", index: 0 },
    10001,
  );
  expect(partyView(game, drawer, 10002).answerAuthor).toEqual({
    displayName: "投稿人",
  });
  expect(partyView(game, guest, 10002).answerAuthor).toBeUndefined();
  const results = partyCommand(
    game,
    { id: guest, name: guest },
    { type: "guess", answer: game.word!.answer },
    10002,
  );
  expect(partyView(results, guest, 10003).answerAuthor).toEqual({
    displayName: "投稿人",
  });
  expect(JSON.stringify(partyView(results, guest, 10003))).not.toContain(
    "username",
  );
});
