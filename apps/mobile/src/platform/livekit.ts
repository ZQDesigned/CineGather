import { registerGlobals } from "@livekit/react-native";
registerGlobals();

import { CriticalTimers, LogLevel, setLogLevel } from "livekit-client";
import { MobileTimers } from "@cinegather/client-core";
import { roomAudio } from "./room-audio";
const timers = new MobileTimers({
  schedule: roomAudio.scheduleTimer,
  cancel: roomAudio.cancelTimer,
});
roomAudio.addListener("timer", ({ id }) => timers.fire(id));
CriticalTimers.setTimeout = (handler, delay, ...args) =>
  timers.timeout(
    () => {
      if (typeof handler === "function") handler(...args);
    },
    Number(delay ?? 0),
  ) as unknown as ReturnType<typeof setTimeout>;
CriticalTimers.setInterval = (handler, delay, ...args) =>
  timers.interval(
    () => {
      if (typeof handler === "function") handler(...args);
    },
    Number(delay ?? 0),
  ) as unknown as ReturnType<typeof setInterval>;
CriticalTimers.clearTimeout = (id) => timers.clear(Number(id));
CriticalTimers.clearInterval = (id) => timers.clear(Number(id));
if (!__DEV__) setLogLevel(LogLevel.warn);
