import { expect, test } from "bun:test";
import { MobileMicrophoneIntent } from "../src/mobile-microphone";

test("revoked microphone permission or a host ban requires a fresh user unmute", () => {
  const mic = new MobileMicrophoneIntent();
  mic.setInRoom(true);
  mic.setPermission(true);
  mic.setWanted(true);
  expect(mic.enabled).toBe(true);
  mic.setAllowed(false);
  mic.setAllowed(true);
  expect(mic.enabled).toBe(false);
  mic.setWanted(true);
  expect(mic.enabled).toBe(true);
  mic.setPermission(false);
  mic.setPermission(true);
  expect(mic.enabled).toBe(false);
});

test("interruption recovery respects manual mute and leaving a room clears microphone intent", () => {
  const mic = new MobileMicrophoneIntent();
  mic.setInRoom(true);
  mic.setPermission(true);
  mic.setWanted(true);
  mic.setInterrupted(true);
  expect(mic.enabled).toBe(false);
  mic.setWanted(false);
  mic.setInterrupted(false);
  expect(mic.enabled).toBe(false);
  mic.setWanted(true);
  mic.setInRoom(false);
  mic.setInRoom(true);
  expect(mic.enabled).toBe(false);
});
