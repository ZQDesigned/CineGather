import { Moon, MoonStar } from "lucide-react-native";
import { IconButton } from "./ui";
import { useRuntime } from "./use-runtime";
import { runtime } from "../runtime";
export function DndButton() {
  const { dnd } = useRuntime();
  return (
    <IconButton
      icon={dnd ? MoonStar : Moon}
      label={dnd ? "恢复通知" : "开启免打扰"}
      active={dnd}
      onPress={() => runtime.setDnd(!dnd)}
    />
  );
}
