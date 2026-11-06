import { useEffect, useRef } from "react";
import type { BoardElement, BoardOperation } from "@cinegather/contracts";
import { report } from "../controller";
function queueState() {
  return {
    pending: new Map<string, number>(),
    submitted: new Set<string>(),
    busy: false,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  };
}
/** Batch crossed objects, keeping drag traffic below the activity command limit. */
export function useWhiteboardEraser(
  contextKey: string,
  editable: boolean,
  onOperation: (operation: BoardOperation) => Promise<void>,
) {
  const queue = useRef(queueState()),
    live = useRef({ editable, onOperation });
  live.current = { editable, onOperation };
  useEffect(() => {
    const previous = queue.current;
    clearTimeout(previous.timer);
    queue.current = queueState();
    return () => {
      clearTimeout(queue.current.timer);
      queue.current = queueState();
    };
  }, [contextKey, editable]);
  function schedule() {
    const state = queue.current;
    if (state.busy || state.timer || !state.pending.size) return;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      if (state !== queue.current || !live.current.editable) return;
      const elements = [...state.pending].map(
        ([elementId, expectedVersion]) => ({ elementId, expectedVersion }),
      );
      state.pending.clear();
      state.busy = true;
      void live.current
        .onOperation({ type: "erase", elements })
        .catch((error) => {
          if (state === queue.current) report(error);
        })
        .finally(() => {
          if (state !== queue.current) return;
          for (const item of elements) state.submitted.delete(item.elementId);
          state.busy = false;
          schedule();
        });
    }, 150);
  }
  return (elements: BoardElement[]) => {
    if (!live.current.editable) return;
    for (const element of elements) {
      if (queue.current.submitted.has(element.id)) continue;
      queue.current.submitted.add(element.id);
      queue.current.pending.set(element.id, element.version);
    }
    schedule();
  };
}
