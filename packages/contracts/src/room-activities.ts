import { z } from "zod";

const coordinate = z.number().finite().min(-5000).max(5000);
export const boardElementInput = z
  .strictObject({
    id: z.uuid(),
    kind: z.enum(["path", "rect", "text", "note", "image"]),
    x: coordinate,
    y: coordinate,
    width: z.number().finite().min(0).max(5000),
    height: z.number().finite().min(0).max(5000),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    strokeWidth: z.number().finite().min(1).max(30),
    points: z
      .array(z.tuple([coordinate, coordinate]))
      .min(1)
      .max(1024)
      .optional(),
    text: z.string().max(1000).optional(),
    imageId: z.uuid().optional(),
  })
  .refine((e) => e.kind !== "path" || !!e.points, { message: "画笔缺少笔迹" })
  .refine((e) => !["text", "note"].includes(e.kind) || !!e.text?.trim(), {
    message: "文字不能为空",
  })
  .refine((e) => (e.kind === "image" ? !!e.imageId : !e.imageId), {
    message: "图片引用不正确",
  });
export type BoardElementInput = z.infer<typeof boardElementInput>;
export type BoardElement = BoardElementInput & {
  authorId: string;
  version: number;
};
export interface BoardEdit {
  actor: string;
  before?: BoardElement;
  after?: BoardElement;
}
export interface WhiteboardDocument {
  revision: number;
  elements: BoardElement[];
  undo: BoardEdit[];
  redo: BoardEdit[];
}
export const boardOperationSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("put"),
    element: boardElementInput,
    expectedVersion: z.number().int().positive().optional(),
  }),
  z.strictObject({
    type: z.literal("remove"),
    elementId: z.uuid(),
    expectedVersion: z.number().int().positive(),
  }),
  z.strictObject({
    type: z.literal("erase"),
    elements: z
      .array(
        z.strictObject({
          elementId: z.uuid(),
          expectedVersion: z.number().int().positive(),
        }),
      )
      .min(1)
      .max(500)
      .refine(
        (items) =>
          new Set(items.map((item) => item.elementId)).size === items.length,
        { message: "不能重复擦除同一对象" },
      ),
  }),
  z.strictObject({ type: z.literal("undo") }),
  z.strictObject({ type: z.literal("redo") }),
  z.strictObject({ type: z.literal("clear") }),
]);
export type BoardOperation = z.infer<typeof boardOperationSchema>;
export const partyActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ready"), ready: z.boolean() }),
  z.strictObject({ type: z.literal("start") }),
  z.strictObject({
    type: z.literal("choose"),
    index: z.number().int().min(0).max(2),
  }),
  z.strictObject({
    type: z.literal("guess"),
    answer: z.string().trim().min(1).max(80),
  }),
  z.strictObject({ type: z.literal("pause") }),
  z.strictObject({ type: z.literal("resume") }),
]);
export type PartyAction = z.infer<typeof partyActionSchema>;
export interface PartyPlayer {
  id: string;
  name: string;
  ready: boolean;
  score: number;
  eligibleRound: number;
}
export interface PartyView {
  kind: "draw" | "quiz";
  phase: "lobby" | "choosing" | "playing" | "results" | "finished" | "paused";
  round: number;
  totalRounds: number;
  deadline?: number;
  serverTime: number;
  drawerId?: string;
  players: PartyPlayer[];
  solvedIds: string[];
  choices?: string[];
  answer?: string;
  category?: string;
  wordLength?: number;
  clue?: string;
}
export const activityTargetSchema = z.enum(["board", "draw", "quiz", "screen"]);
export type ActivityTarget = z.infer<typeof activityTargetSchema>;
export interface ActivityRequest {
  id: string;
  userId: string;
  name: string;
  target: ActivityTarget;
  generation: number;
  status: "pending" | "approved";
  expiresAt: number;
}
export interface ActivityPermission {
  userId: string;
  board: boolean;
  game: boolean;
}
export interface ActivitySnapshot {
  roomId: string;
  revision: number;
  generation: number;
  kind: "idle" | "board" | "game" | "screen";
  ownerId: string;
  starterId?: string;
  title?: string;
  board?: {
    elements: BoardElement[];
    revision: number;
    canUndo: boolean;
    canRedo: boolean;
    canEdit: boolean;
    editorIds: string[];
  };
  game?: PartyView;
  requests: ActivityRequest[];
  permissions: ActivityPermission[];
}
export const activityCommandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("start"),
    target: activityTargetSchema,
    generation: z.number().int().nonnegative(),
    requestId: z.uuid().optional(),
    historyId: z.uuid().optional(),
  }),
  z.strictObject({
    type: z.literal("end"),
    generation: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("request"),
    target: activityTargetSchema,
    generation: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("decide"),
    requestId: z.uuid(),
    approve: z.boolean(),
  }),
  z.strictObject({ type: z.literal("cancel"), requestId: z.uuid() }),
  z
    .strictObject({
      type: z.literal("permissions"),
      userId: z.uuid(),
      board: z.boolean().optional(),
      game: z.boolean().optional(),
    })
    .refine((p) => p.board !== undefined || p.game !== undefined, {
      message: "请选择要修改的权限",
    }),
  z.strictObject({
    type: z.literal("board-editor"),
    generation: z.number().int().nonnegative(),
    userId: z.uuid(),
    enabled: z.boolean(),
  }),
  z.strictObject({
    type: z.literal("board"),
    generation: z.number().int().nonnegative(),
    operation: boardOperationSchema,
  }),
  z.strictObject({
    type: z.literal("party"),
    generation: z.number().int().nonnegative(),
    action: partyActionSchema,
  }),
]);
export type ActivityCommand = z.infer<typeof activityCommandSchema>;
export interface WhiteboardRecord {
  id: string;
  title: string;
  createdAt: string;
  elementCount: number;
}

export const boardPresenceInputSchema = z.strictObject({
  generation: z.number().int().nonnegative(),
  cursor: z.object({ x: coordinate, y: coordinate }).strict().nullable(),
  draft: z
    .object({
      element: boardElementInput,
      expectedVersion: z.number().int().positive().optional(),
    })
    .strict()
    .nullable(),
});
export type BoardPresenceInput = z.infer<typeof boardPresenceInputSchema>;
export interface BoardPresence extends BoardPresenceInput {
  roomId: string;
  userId: string;
  name: string;
}
