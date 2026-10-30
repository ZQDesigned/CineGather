import { useSyncExternalStore } from "react";
import { runtime } from "../runtime";
export function useRuntime() {
  return useSyncExternalStore(runtime.subscribe, runtime.snapshot);
}
export function useSession() {
  return useSyncExternalStore(
    runtime.session.subscribe,
    runtime.session.snapshot,
  );
}
export function useMedia() {
  return useSyncExternalStore(runtime.media.subscribe, runtime.media.snapshot);
}
export function action(work: () => Promise<unknown>) {
  return () => work().catch((e) => runtime.fail(e));
}
