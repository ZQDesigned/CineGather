import {
  boardCursorColor,
  boardStrokePath,
  appendBoardSamples,
  boardLiveDraft,
  boardSweepHits,
} from "@cinegather/client-core";
import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { Input, Modal, App } from "antd";
import {
  MousePointer2,
  Move,
  Pencil,
  Square,
  Type,
  StickyNote,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  ImagePlus,
  ScanLine,
  Download,
} from "lucide-react";
import type {
  BoardElement,
  BoardElementInput,
  BoardOperation,
  BoardPresence,
  BoardPresenceInput,
} from "@cinegather/contracts";
import { unwrap } from "@cinegather/api-client";
import { api, report } from "../controller";
import { Button } from "./Controls";
import { useWhiteboardEraser } from "./useWhiteboardEraser";
import { useRetainedDialog } from "./useRetainedDialog";
import { normalizeBoardImage, screenshotBoardImage } from "../whiteboard-image";
type Tool = "pointer" | "select" | "path" | "rect" | "text" | "note" | "eraser";
export function WhiteboardImage({ element }: { element: BoardElement }) {
  const [data, setData] = useState<string>();
  useEffect(() => {
    let active = true;
    void api
      .GET("/api/v1/whiteboards/images/{imageId}", {
        params: { path: { imageId: element.imageId! } },
      })
      .then(unwrap)
      .then((r) => {
        if (active) setData(r.data);
      })
      .catch(report);
    return () => {
      active = false;
    };
  }, [element.imageId]);
  return data ? (
    <image
      x={element.x}
      y={element.y}
      width={element.width}
      height={element.height}
      href={data}
      preserveAspectRatio="xMidYMid meet"
    />
  ) : null;
}
export function BoardShape({ element }: { element: BoardElementInput }) {
  if (element.kind === "image")
    return <WhiteboardImage element={element as BoardElement} />;
  if (element.kind === "path")
    return (
      <path
        transform={`translate(${element.x} ${element.y})`}
        d={boardStrokePath(element.points)}
        fill="none"
        stroke={element.color}
        strokeWidth={element.strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  if (element.kind === "rect")
    return (
      <rect
        x={element.x}
        y={element.y}
        width={element.width}
        height={element.height}
        fill="none"
        stroke={element.color}
        strokeWidth={element.strokeWidth}
      />
    );
  return (
    <g>
      {element.kind === "note" && (
        <rect
          x={element.x}
          y={element.y}
          width={element.width}
          height={element.height}
          rx={6}
          fill="#e5d9f7"
        />
      )}
      <text
        x={element.x + 12}
        y={element.y + 30}
        fill={element.color}
        fontSize={24}
      >
        {(element.text ?? "").split("\n").map((line, i) => (
          <tspan key={i} x={element.x + 12} dy={i ? 31 : 0}>
            {line}
          </tspan>
        ))}
      </text>
    </g>
  );
}
export function Whiteboard({
  elements,
  editable,
  importable,
  exportable = true,
  canUndo,
  canRedo,
  canClear,
  onOperation,
  onImage,
  contextKey = "history",
  presence = [],
  onPresence,
}: {
  elements: BoardElement[];
  editable: boolean;
  importable: boolean;
  exportable?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canClear: boolean;
  onOperation: (operation: BoardOperation) => Promise<void>;
  onImage?: (data: string) => Promise<void>;
  contextKey?: string;
  presence?: BoardPresence[];
  onPresence?: (frame: Omit<BoardPresenceInput, "generation">) => void;
}) {
  const svg = useRef<SVGSVGElement>(null),
    gesture = useRef<
      | {
          start: [number, number];
          element: BoardElementInput;
          original?: BoardElement;
          pointer: number;
        }
      | undefined
    >(undefined);
  const erase = useWhiteboardEraser(contextKey, editable, onOperation);
  const erasing = useRef<
    { pointer: number; last: [number, number]; seen: Set<string> } | undefined
  >(undefined);
  function sweep(point: [number, number]) {
    const active = erasing.current,
      matrix = svg.current?.getScreenCTM();
    if (!active || !matrix || !editable) return;
    const radius = 5 / Math.max(0.001, Math.hypot(matrix.a, matrix.b));
    const hits = boardSweepHits(elements, active.last, point, radius).filter(
      (e) => !active.seen.has(e.id),
    );
    for (const element of hits) active.seen.add(element.id);
    active.last = point;
    erase(hits);
  }
  const drawingClip = useId();
  const cursor = useRef<{ x: number; y: number } | null>(null);
  const pointerPosition = useRef<{ x: number; y: number } | null>(null);
  const publishPresence = useRef(onPresence);
  publishPresence.current = onPresence;
  const [tool, setTool] = useState<Tool>("path"),
    [color, setColor] = useState("#8161ac"),
    [draft, setDraft] = useState<BoardElementInput>(),
    [selected, setSelected] = useState<string>(),
    [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{
    kind: "text" | "image" | "clear";
    element?: BoardElementInput;
    data?: string;
  }>();
  const retained = useRetainedDialog(dialog),
    [text, setText] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const { message } = App.useApp();
  const context = useRef(contextKey);
  context.current = contextKey;
  useEffect(() => {
    setDialog(undefined);
    erasing.current = undefined;
    gesture.current = undefined;
    setDraft(undefined);
    setSelected(undefined);
    pointerPosition.current = null;
    cursor.current = null;
  }, [contextKey]);
  useEffect(() => {
    const canvas = svg.current;
    if (!canvas) return;
    let frame = 0;
    const refresh = () => {
      frame = 0;
      const screen = pointerPosition.current;
      const matrix = canvas.getScreenCTM();
      if (!screen || !matrix) return;
      // CSS pixels belong to this window only. Reproject through the live SVG
      // matrix whenever its size or position changes, even without pointermove.
      const point = new DOMPoint(screen.x, screen.y).matrixTransform(
        matrix.inverse(),
      );
      const box = canvas.viewBox.baseVal;
      const inside =
        point.x >= box.x &&
        point.y >= box.y &&
        point.x <= box.x + box.width &&
        point.y <= box.y + box.height;
      const next = inside
        ? { x: Math.round(point.x), y: Math.round(point.y) }
        : null;
      if (cursor.current?.x === next?.x && cursor.current?.y === next?.y)
        return;
      cursor.current = next;
      const current = gesture.current;
      publishPresence.current?.({
        cursor: next,
        draft: current
          ? boardLiveDraft(current.element, current.original?.version)
          : null,
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(refresh);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    const stage = canvas.closest(".room-activity-stage");
    if (stage) observer.observe(stage);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, []);
  useEffect(() => {
    setTool(editable ? "path" : "pointer");
    if (!editable) {
      setDialog(undefined);
      erasing.current = undefined;
      gesture.current = undefined;
      setDraft(undefined);
      onPresence?.({ cursor: cursor.current, draft: null });
    }
  }, [editable]);
  function position(event: {
    clientX: number;
    clientY: number;
  }): [number, number] {
    pointerPosition.current = { x: event.clientX, y: event.clientY };
    const point = svg.current!.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const p = point.matrixTransform(svg.current!.getScreenCTM()!.inverse());
    return [p.x, p.y];
  }
  async function run(operation: BoardOperation) {
    try {
      await onOperation(operation);
    } catch (e) {
      report(e);
    }
  }
  function down(event: PointerEvent<SVGSVGElement>) {
    if (busy || event.button !== 0) return;
    event.currentTarget.focus({ preventScroll: true });
    const [x, y] = position(event);
    if (x < 0 || x > 1600 || y < 0 || y > 900) return;
    cursor.current = { x, y };
    onPresence?.({ cursor: cursor.current, draft: null });
    if (!editable || tool === "pointer") return;
    const target = (event.target as Element)
        .closest("[data-element]")
        ?.getAttribute("data-element"),
      existing = elements.find((e) => e.id === target);
    if (tool === "eraser") {
      erasing.current = {
        pointer: event.pointerId,
        last: [x, y],
        seen: new Set(),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      sweep([x, y]);
      return;
    }
    if (tool === "select") {
      setSelected(existing?.id);
      if (!existing) return;
      gesture.current = {
        start: [x, y],
        element: { ...existing },
        original: existing,
        pointer: event.pointerId,
      };
    } else {
      const element: BoardElementInput = {
        id: crypto.randomUUID(),
        kind: tool,
        x,
        y,
        width: tool === "note" ? 260 : 220,
        height: tool === "note" ? 160 : 60,
        color,
        strokeWidth: 3,
        ...(tool === "path"
          ? { x: 0, y: 0, points: [[x, y] as [number, number]] }
          : {}),
        ...(["text", "note"].includes(tool) ? { text: "" } : {}),
      };
      if (tool === "text" || tool === "note") {
        setText("");
        setDialog({ kind: "text", element });
        return;
      }
      gesture.current = { start: [x, y], element, pointer: event.pointerId };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraft({ ...gesture.current.element });
    onPresence?.({
      cursor: cursor.current,
      draft: boardLiveDraft(
        gesture.current.element,
        gesture.current.original?.version,
      ),
    });
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const [x, y] = position(event);
    cursor.current =
      x >= 0 && x <= 1600 && y >= 0 && y <= 900 ? { x, y } : null;
    const eraser = erasing.current;
    if (eraser?.pointer === event.pointerId) {
      if (event.buttons & 1) sweep([x, y]);
      else erasing.current = undefined;
      onPresence?.({ cursor: cursor.current, draft: null });
      return;
    }
    const g = gesture.current;
    if (!g || g.pointer !== event.pointerId) {
      onPresence?.({ cursor: cursor.current, draft: null });
      return;
    }
    const [sx, sy] = g.start;
    if (g.original) {
      g.element.x = g.original.x + x - sx;
      g.element.y = g.original.y + y - sy;
    } else if (g.element.kind === "path") {
      const native = event.nativeEvent;
      const samples = native.getCoalescedEvents?.() ?? [];
      const matrix = svg.current!.getScreenCTM()!.inverse();
      appendBoardSamples(
        g.element.points!,
        [...samples, native].map((sample) => {
          const point = new DOMPoint(
            sample.clientX,
            sample.clientY,
          ).matrixTransform(matrix);
          return [
            Math.round(point.x * 100) / 100,
            Math.round(point.y * 100) / 100,
          ];
        }),
      );
    } else {
      g.element.x = Math.min(sx, x);
      g.element.y = Math.min(sy, y);
      g.element.width = Math.abs(x - sx);
      g.element.height = Math.abs(y - sy);
    }
    setDraft({ ...g.element });
    onPresence?.({
      cursor: cursor.current,
      draft: boardLiveDraft(g.element, g.original?.version),
    });
  }
  function up(event: PointerEvent<SVGSVGElement>) {
    if (gesture.current?.element.kind === "path" && !gesture.current.original)
      move(event);
    erasing.current = undefined;
    const g = gesture.current;
    if (!g) return;
    gesture.current = undefined;
    const {
      authorId: _author,
      version: _version,
      ...element
    } = g.element as BoardElement;
    void run({
      type: "put",
      element,
      expectedVersion: g.original?.version,
    }).finally(() => {
      setDraft((current) => (current?.id === element.id ? undefined : current));
      if (!gesture.current)
        onPresence?.({ cursor: cursor.current, draft: null });
    });
  }
  async function importImage(source: File | string) {
    const began = contextKey;
    setBusy(true);
    try {
      const data = await normalizeBoardImage(source);
      if (context.current === began) setDialog({ kind: "image", data });
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function capture() {
    const began = contextKey;
    setBusy(true);
    try {
      const data = await screenshotBoardImage();
      if (data && context.current === began) setDialog({ kind: "image", data });
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!retained.value || busy) return;
    setBusy(true);
    try {
      const item = retained.value;
      if (item.kind === "image") {
        await onImage?.(item.data!);
      } else if (item.kind === "clear") await onOperation({ type: "clear" });
      else if (text.trim())
        await onOperation({
          type: "put",
          element: { ...item.element!, text: text.trim() },
        });
      else return;
      setDialog((current) => (current === item ? undefined : current));
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function exportImage() {
    try {
      const clone = svg.current!.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.setAttribute("width", "1600");
      clone.setAttribute("height", "900");
      clone
        .querySelectorAll("[data-selection], [data-transient]")
        .forEach((e) => e.remove());
      const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
          type: "image/svg+xml",
        }),
        url = URL.createObjectURL(blob);
      try {
        const data = await normalizeBoardImage(url),
          a = document.createElement("a");
        a.href = data;
        a.download = "映聚白板.png";
        a.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      void message.error("暂时无法导出白板");
    }
  }
  const tools: [Tool, string, typeof Pencil][] = [
    ["pointer", "指针", MousePointer2],
    ["select", "选择移动", Move],
    ["path", "画笔", Pencil],
    ["rect", "矩形", Square],
    ["text", "文字", Type],
    ["note", "便签", StickyNote],
    ["eraser", "擦除", Eraser],
  ];
  return (
    <div className="collab-board">
      <svg
        ref={svg}
        className="collab-canvas"
        viewBox="0 0 1600 900"
        preserveAspectRatio="xMidYMid meet"
        aria-label="协作白板"
        tabIndex={0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={() => {
          if (!gesture.current && !erasing.current) {
            pointerPosition.current = null;
            cursor.current = null;
            onPresence?.({ cursor: null, draft: null });
          }
        }}
        onLostPointerCapture={() => {
          erasing.current = undefined;
        }}
        onPointerCancel={() => {
          erasing.current = undefined;
          gesture.current = undefined;
          setDraft(undefined);
          pointerPosition.current = null;
          cursor.current = null;
          onPresence?.({ cursor: null, draft: null });
        }}
      >
        <defs>
          <clipPath id={drawingClip}>
            <rect width="1600" height="900" />
          </clipPath>
        </defs>
        <rect width="1600" height="900" fill="#f1eef6" />
        <g clipPath={`url(#${drawingClip})`}>
          {elements
            .filter((e) => e.id !== draft?.id)
            .map((element) => (
              <g key={`${contextKey}:${element.id}`} data-element={element.id}>
                <BoardShape element={element} />
                {selected === element.id && tool === "select" && (
                  <rect
                    data-selection
                    x={element.x - 3}
                    y={element.y - 3}
                    width={element.width + 6}
                    height={element.height + 6}
                    fill="none"
                    stroke="#9d7bcc"
                    strokeDasharray="8 5"
                  />
                )}
              </g>
            ))}
          {draft && <BoardShape element={draft} />}
        </g>
        {presence.map((peer) => (
          <g key={peer.userId} data-transient pointerEvents="none">
            {peer.draft && (
              <g opacity={0.85} clipPath={`url(#${drawingClip})`}>
                <BoardShape element={peer.draft.element} />
              </g>
            )}
            {peer.cursor && (
              <g
                data-remote-cursor={peer.userId}
                transform={`translate(${peer.cursor.x} ${peer.cursor.y})`}
              >
                <path
                  d="M0 0 L5 26 L12 18 L22 17 Z"
                  fill={boardCursorColor(peer.userId)}
                  stroke="white"
                  strokeWidth={2}
                />
                <rect
                  x={18}
                  y={23}
                  width={Math.min(330, peer.name.length * 24 + 22)}
                  height={34}
                  rx={8}
                  fill={boardCursorColor(peer.userId)}
                />
                <text x={28} y={48} fontSize={23} fill="white">
                  {peer.name.slice(0, 12)}
                </text>
              </g>
            )}
          </g>
        ))}
      </svg>
      {(editable || onPresence) && (
        <div className="collab-tools">
          {tools
            .filter(([value]) => editable || value === "pointer")
            .map(([value, label, Icon]) => (
              <Button
                key={value}
                aria-label={label}
                aria-pressed={tool === value}
                className={tool === value ? "active" : ""}
                onClick={() => setTool(value)}
              >
                <Icon size={17} />
              </Button>
            ))}
          {editable && (
            <>
              <input
                aria-label="画笔颜色"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
              <Button
                disabled={!canUndo}
                aria-label="撤销"
                onClick={() => void run({ type: "undo" })}
              >
                <Undo2 size={17} />
              </Button>
              <Button
                disabled={!canRedo}
                aria-label="重做"
                onClick={() => void run({ type: "redo" })}
              >
                <Redo2 size={17} />
              </Button>
              {canClear && (
                <Button
                  aria-label="清空白板"
                  onClick={() => setDialog({ kind: "clear" })}
                >
                  <Trash2 size={17} />
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {(importable || exportable) && (
        <div className="collab-import">
          {importable && (
            <>
              <Button loading={busy} onClick={() => void capture()}>
                <ScanLine size={16} />
                截取屏幕
              </Button>
              <Button disabled={busy} onClick={() => file.current?.click()}>
                <ImagePlus size={16} />
                上传图片
              </Button>
              <input
                hidden
                ref={file}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  e.target.value = "";
                  if (chosen) void importImage(chosen);
                }}
              />
            </>
          )}
          {exportable && (
            <Button aria-label="导出白板" onClick={() => void exportImage()}>
              <Download size={16} />
            </Button>
          )}
        </div>
      )}
      <Modal
        open={retained.open}
        afterClose={retained.afterClose}
        title={
          retained.value?.kind === "image"
            ? "确认加入图片"
            : retained.value?.kind === "clear"
              ? "清空白板"
              : "添加文字"
        }
        onCancel={() => setDialog(undefined)}
        onOk={() => void save()}
        confirmLoading={busy}
        okText="确认"
        cancelText="取消"
        destroyOnHidden
        centered
      >
        {retained.value?.kind === "image" ? (
          <img
            className="collab-image-preview"
            src={retained.value.data}
            alt="待加入白板的图片"
          />
        ) : retained.value?.kind === "clear" ? (
          <p>清空当前画布内容，此操作不能撤销。</p>
        ) : (
          <Input.TextArea
            aria-label="白板文字"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={1000}
            rows={4}
          />
        )}
      </Modal>
    </div>
  );
}
