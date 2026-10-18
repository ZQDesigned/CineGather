type KeyGroups = number[][];
const macKeys: Record<string, number> = {
  A: 0,
  S: 1,
  D: 2,
  F: 3,
  H: 4,
  G: 5,
  Z: 6,
  X: 7,
  C: 8,
  V: 9,
  B: 11,
  Q: 12,
  W: 13,
  E: 14,
  R: 15,
  Y: 16,
  T: 17,
  "1": 18,
  "2": 19,
  "3": 20,
  "4": 21,
  "6": 22,
  "5": 23,
  "9": 25,
  "7": 26,
  "8": 28,
  "0": 29,
  O: 31,
  U: 32,
  I: 34,
  P: 35,
  L: 37,
  J: 38,
  K: 40,
  N: 45,
  M: 46,
  SPACE: 49,
  ENTER: 36,
  RETURN: 36,
  TAB: 48,
  ESCAPE: 53,
  ESC: 53,
  LEFT: 123,
  RIGHT: 124,
  DOWN: 125,
  UP: 126,
  F1: 122,
  F2: 120,
  F3: 99,
  F4: 118,
  F5: 96,
  F6: 97,
  F7: 98,
  F8: 100,
  F9: 101,
  F10: 109,
  F11: 103,
  F12: 111,
};
export function shortcutKeys(
  accelerator: string,
  platform: NodeJS.Platform,
): KeyGroups {
  const invalid = () =>
    new Error(
      "全局按住说话请使用修饰键加字母、数字、空格、方向键或 F1–F12，例如 Control+Alt+Space",
    );
  if (!["win32", "darwin"].includes(platform)) throw invalid();
  const parts = accelerator
    .toUpperCase()
    .split("+")
    .map((part) => part.trim());
  const primary = parts.pop()!;
  if (!parts.length) throw invalid();
  let key: number | undefined;
  if (platform === "darwin") key = macKeys[primary];
  else if (/^[A-Z0-9]$/.test(primary)) key = primary.charCodeAt(0);
  else if (/^F(?:[1-9]|1[0-2])$/.test(primary))
    key = 111 + Number(primary.slice(1));
  else
    key = (
      {
        SPACE: 32,
        TAB: 9,
        ENTER: 13,
        RETURN: 13,
        ESCAPE: 27,
        ESC: 27,
        LEFT: 37,
        UP: 38,
        RIGHT: 39,
        DOWN: 40,
      } as Record<string, number>
    )[primary];
  if (key === undefined) throw invalid();
  const groups: KeyGroups = [[key]];
  const seen = new Set<string>();
  for (let part of parts) {
    if (["COMMANDORCONTROL", "CMDORCTRL", "COMMANDORCTRL"].includes(part))
      part = platform === "darwin" ? "COMMAND" : "CONTROL";
    if (part === "CTRL") part = "CONTROL";
    if (["CMD", "META", "SUPER"].includes(part)) part = "COMMAND";
    if (part === "OPTION") part = "ALT";
    if (seen.has(part)) throw invalid();
    seen.add(part);
    const group =
      platform === "darwin"
        ? (
            {
              COMMAND: [55, 54],
              CONTROL: [59, 62],
              SHIFT: [56, 60],
              ALT: [58, 61],
            } as Record<string, number[]>
          )[part]
        : (
            {
              COMMAND: [91, 92],
              CONTROL: [17],
              SHIFT: [16],
              ALT: [18],
            } as Record<string, number[]>
          )[part];
    if (!group) throw invalid();
    groups.push(group);
  }
  return groups;
}

export class HoldToTalk {
  private keys: KeyGroups = [];
  private held = false;
  private stopPolling?: () => void;
  constructor(
    private readonly down: (key: number) => boolean,
    private readonly changed: (held: boolean) => void,
    private readonly poll: (tick: () => void) => () => void = (tick) => {
      const timer = setInterval(tick, 20);
      timer.unref();
      return () => clearInterval(timer);
    },
  ) {}
  configure(keys: KeyGroups) {
    this.release();
    this.keys = keys;
  }
  private allDown() {
    try {
      return (
        this.keys.length > 0 &&
        this.keys.every((group) => group.some(this.down))
      );
    } catch {
      return false;
    }
  }
  press() {
    if (this.held || !this.allDown()) return;
    this.held = true;
    this.changed(true);
    this.stopPolling = this.poll(() => {
      if (!this.allDown()) this.release();
    });
  }
  release() {
    this.stopPolling?.();
    this.stopPolling = undefined;
    if (!this.held) return;
    this.held = false;
    this.changed(false);
  }
}
