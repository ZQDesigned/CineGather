import { Button } from "./ui";
import { useRuntime } from "./use-runtime";
import { runtime } from "../runtime";
export function DndButton() {
  const { dnd } = useRuntime();
  return (
    <Button onPress={() => runtime.setDnd(!dnd)}>
      {dnd ? "恢复通知" : "免打扰"}
    </Button>
  );
}
