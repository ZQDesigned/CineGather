import { test, expect } from "bun:test";
import {
  esportsConfigurationSchema,
  esportsMediaRights,
  esportsSeatLimit,
  esportsOwnVoice,
  esportsCapacityTotal,
  coachVoiceAllowed,
  defaultEsportsConfiguration,
} from "../src/index";
test("dynamic teams validate distinct stable ids and independent player/coach limits", () => {
  const groups = Array.from({ length: 6 }, (_, i) => ({
    id: "group-" + i,
    name: "组" + i,
    playerSeats: 5,
    coachSeats: 2,
  }));
  const c = esportsConfigurationSchema.parse({
    groups,
    tacticalPauseSeconds: 60,
  });
  expect(esportsCapacityTotal(c)).toBe(52);
  expect(esportsSeatLimit({ kind: "coach", team: "group-0" }, c)).toBe(2);
  expect(esportsSeatLimit({ kind: "player", team: "group-0" }, c)).toBe(5);
  expect(esportsSeatLimit({ kind: "coach", team: "absent" }, c)).toBe(0);
  for (const bad of [
    { groups: [...groups, groups[0]], tacticalPauseSeconds: 60 },
    { groups: [groups[0], groups[0]], tacticalPauseSeconds: 60 },
    { groups: [{ ...groups[0], playerSeats: 6 }], tacticalPauseSeconds: 60 },
    { groups: [{ ...groups[0], coachSeats: 3 }], tacticalPauseSeconds: 60 },
    { groups, tacticalPauseSeconds: 0 },
  ])
    expect(esportsConfigurationSchema.safeParse(bad).success).toBe(false);
  expect(esportsCapacityTotal(defaultEsportsConfiguration)).toBe(20);
});
test("coaches can only watch their team and only publish team voice while explicitly eligible", () => {
  const seat = { kind: "coach" as const, team: "a" };
  expect(
    esportsMediaRights(
      seat,
      { kind: "video", publicationId: crypto.randomUUID() },
      false,
      "a",
    ).subscribe,
  ).toBe(true);
  expect(
    esportsMediaRights(
      seat,
      { kind: "video", publicationId: crypto.randomUUID() },
      false,
      "b",
    ).subscribe,
  ).toBe(false);
  expect(
    esportsMediaRights(
      seat,
      { kind: "video", publicationId: crypto.randomUUID() },
      true,
      "a",
    ).publish,
  ).toBe(false);
  expect(esportsOwnVoice(seat)).toEqual({ kind: "team", team: "a" });
  expect(esportsMediaRights(seat, { kind: "team", team: "a" })).toEqual({
    publish: false,
    subscribe: true,
  });
  expect(
    esportsMediaRights(
      seat,
      { kind: "team", team: "a" },
      false,
      undefined,
      true,
    ),
  ).toEqual({ publish: true, subscribe: true });
  expect(
    esportsMediaRights(
      seat,
      { kind: "team", team: "b" },
      false,
      undefined,
      true,
    ),
  ).toEqual({ publish: false, subscribe: false });
});
test("manual voice policy remains independent of tactical pause expiry", () => {
  const now = 1000;
  expect(coachVoiceAllowed("auto", new Date(2000), now)).toBe(true);
  expect(coachVoiceAllowed("auto", new Date(1000), now)).toBe(false);
  expect(coachVoiceAllowed("open", new Date(0), now)).toBe(true);
  expect(coachVoiceAllowed("closed", new Date(2000), now)).toBe(false);
  expect(coachVoiceAllowed("auto", null, now)).toBe(false);
});
