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

test("a host mute while permission is pending cannot be undone by a late permission grant", () => {
  const intent = new MobileMicrophoneIntent();
  intent.setInRoom(true);
  const request = intent.beginUnmute();
  intent.setWanted(false);
  expect(intent.completeUnmute(request!, true)).toBe(false);
  expect(intent.enabled).toBe(false);
  expect(intent.requested).toBe(false);
});
test("an older device permission result cannot overtake a newer unmute or a room exit", () => {
  const intent = new MobileMicrophoneIntent();
  intent.setInRoom(true);
  const older = intent.beginUnmute(),
    newer = intent.beginUnmute();
  expect(intent.completeUnmute(older!, true)).toBe(false);
  expect(intent.completeUnmute(newer!, true)).toBe(true);
  intent.setWanted(false);
  const next = intent.beginUnmute();
  intent.setInRoom(false);
  expect(intent.completeUnmute(next!, true)).toBe(false);
  expect(intent.enabled).toBe(false);
});
