import type {
  Session,
  DisplayMediaRequestHandlerHandlerRequest,
} from "electron";
import type { CaptureSelection } from "@cinegather/contracts";

type CaptureOptions = {
  takeSelection(): (CaptureSelection & { expiresAt: number }) | undefined;
  isTrustedRequest(request: DisplayMediaRequestHandlerHandlerRequest): boolean;
  getSources(): Promise<{ id: string; name: string }[]>;
  platform: NodeJS.Platform;
};

export function configureDisplayCapture(
  session: Pick<Session, "setDisplayMediaRequestHandler">,
  options: CaptureOptions,
) {
  session.setDisplayMediaRequestHandler(
    async (request, callback) => {
      const choice = options.takeSelection();
      if (
        !request.userGesture ||
        !options.isTrustedRequest(request) ||
        !choice ||
        choice.expiresAt <= Date.now()
      ) {
        callback(null);
        return;
      }
      try {
        const source = (await options.getSources()).find(
          (source) => source.id === choice.sourceId,
        );
        if (!source) {
          callback(null);
          return;
        }
        callback({
          video: source,
          ...(choice.systemAudio &&
          request.audioRequested &&
          ["win32", "darwin"].includes(options.platform)
            ? { audio: "loopback" as const }
            : {}),
        });
      } catch {
        callback(null);
      }
    },
    // Keep the explicit in-app source authoritative on macOS too. The native
    // picker bypasses this handler, including its one-use source approval.
    { useSystemPicker: false },
  );
}
