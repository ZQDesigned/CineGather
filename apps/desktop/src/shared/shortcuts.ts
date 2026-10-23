export interface ShortcutInput {
  code: string;
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
  isComposing?: boolean;
  isAutoRepeat?: boolean;
}

// Physical key codes remain stable with IMEs and Option/Shift-transformed characters.
export function recordedShortcut(input: ShortcutInput): string | undefined {
  if (input.isComposing || input.isAutoRepeat) return;
  const modifiers = [
    input.control && "Control",
    input.meta && "Command",
    input.alt && "Alt",
    input.shift && "Shift",
  ].filter(Boolean);
  if (!modifiers.length) return;
  let key: string | undefined;
  if (/^Key[A-Z]$/.test(input.code)) key = input.code.slice(3);
  else if (/^Digit[0-9]$/.test(input.code)) key = input.code.slice(5);
  else if (/^F(?:[1-9]|1[0-2])$/.test(input.code)) key = input.code;
  else if (["Space", "Enter", "Tab"].includes(input.code)) key = input.code;
  else if (/^Arrow(Up|Down|Left|Right)$/.test(input.code))
    key = input.code.slice(5);
  return key ? [...modifiers, key].join("+") : undefined;
}

export function displayShortcut(value: string, platform: string): string {
  const mac = platform === "darwin";
  const names: Record<string, string> = {
    COMMANDORCONTROL: mac ? "⌘" : "Ctrl",
    COMMAND: mac ? "⌘" : "Win",
    CONTROL: mac ? "⌃" : "Ctrl",
    ALT: mac ? "⌥" : "Alt",
    SHIFT: mac ? "⇧" : "Shift",
    SPACE: "空格",
    UP: "↑",
    DOWN: "↓",
    LEFT: "←",
    RIGHT: "→",
  };
  return value
    .split("+")
    .map((key) => names[key.toUpperCase()] ?? key)
    .join(" + ");
}
