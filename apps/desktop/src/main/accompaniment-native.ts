import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { AccompanimentHost } from "./accompaniment";
import { WindowsAudio, supportsProcessAudio } from "./windows-audio";
import type { ProcessAudioPacket } from "@cinegather/contracts";
const execute = promisify(execFile);
const applications = z
  .array(
    z.object({
      key: z.string().min(1).max(1024),
      name: z.string().min(1).max(2048),
      identity: z.string().min(1).max(2048),
      target: z.string().min(1).max(1024),
    }),
  )
  .max(200);
export function createAccompaniment(options: {
  executable: string;
  platform: string;
  release: string;
  ownerPid: number;
  ownBundle: string;
  data(packet: ProcessAudioPacket): void;
  failed(id: string, message: string): void;
}) {
  const mac = options.platform === "darwin";
  const audio = new WindowsAudio({
    ...options,
    supported: mac || supportsProcessAudio(options.release),
    arguments: (target) =>
      mac
        ? ["--accompaniment", target.window, options.ownBundle]
        : [target.mode, target.window, String(options.ownerPid)],
  });
  const list = async () => {
    const { stdout } = await execute(
      options.executable,
      mac
        ? ["--audio-applications", "", options.ownBundle]
        : ["list", "0", String(options.ownerPid)],
      {
        encoding: "utf8",
        timeout: 8000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    return applications.parse(JSON.parse(stdout));
  };
  const host = new AccompanimentHost({
    list,
    stop: () => audio.stop(),
    start: (target) => {
      const window = mac ? target : /^process:(\d+:\d+)$/.exec(target)?.[1];
      if (!window) throw new Error("伴奏来源不可用，请刷新列表");
      return audio.startIsolated({
        mode: mac ? "application" : "process",
        window,
      });
    },
  });
  return {
    host,
    acknowledge: (id: string, sequence: number) =>
      audio.acknowledge(id, sequence),
  };
}
