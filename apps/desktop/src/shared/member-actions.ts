import type { EsportsSeat } from "@cinegather/contracts";
export type MemberManagementAction =
  | "seat"
  | "transfer"
  | "mute"
  | "stop-accompaniment"
  | "block-mic"
  | "block-share"
  | "stop-share"
  | "remove";
export interface MemberManagementInput {
  owner: boolean;
  self: boolean;
  mode?: "standard" | "esports";
  seat?: EsportsSeat;
  sharing?: boolean;
}
export function memberManagementActions(
  input: MemberManagementInput,
): MemberManagementAction[] {
  if (!input.owner || (input.mode === "esports" && !input.seat)) return [];
  if (input.self) return input.mode === "esports" ? ["seat"] : [];
  const esports = input.mode === "esports";
  const screen = !esports || input.seat?.kind === "player";
  return [
    ...(esports ? ["seat" as const] : []),
    "transfer",
    "mute",
    ...(!esports ? ["stop-accompaniment" as const] : []),
    "block-mic",
    ...(screen ? ["block-share" as const] : []),
    ...(screen && input.sharing ? ["stop-share" as const] : []),
    "remove",
  ];
}
