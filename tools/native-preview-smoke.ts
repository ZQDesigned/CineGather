import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { delimiter, join, resolve } from "node:path";
import assert from "node:assert/strict";
import { expect, type Page } from "@playwright/test";
import { NativeProtocol } from "../apps/desktop/src/main/native-protocol";

type Status = {
  frames: number;
  active: boolean;
  previewActive: boolean;
  previewFrames: number;
  previewBytes: number;
  previewDroppedFrames: number;
};
export async function nativePreviewSmoke(
  page: Page,
  executable: string,
  runtime: string,
  receiverPath: string,
) {
  const receiver = spawn(resolve(receiverPath), [], {
    stdio: "pipe",
    windowsHide: true,
  });
  receiver.stderr.resume();
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("preview-receiver-timeout")),
        10000,
      );
      createInterface({ input: receiver.stdout }).once("line", (line) => {
        clearTimeout(timeout);
        resolve(JSON.parse(line).port);
      });
      receiver.on("error", reject);
    });
    const results: unknown[] = [];
    for (const fps of [30, 60]) {
      const child = spawn(
        resolve(executable),
        [resolve(runtime), String(fps), `http://127.0.0.1:${port}/whip`],
        {
          stdio: "pipe",
          windowsHide: true,
          env: {
            ...process.env,
            ...(process.platform === "win32"
              ? {
                  PATH:
                    join(resolve(runtime), "bin/64bit") +
                    delimiter +
                    process.env.PATH,
                }
              : {}),
          },
        },
      );
      const pipe = new NativeProtocol(
        (data) => child.stdin.write(data),
        () => child.kill(),
      );
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data) => pipe.receive(data));
      let fixtureError = "";
      child.stderr.on("data", (data) => {
        fixtureError = (fixtureError + String(data)).slice(-4096);
      });
      child.on("error", (error) => pipe.close(error));
      child.stdin.on("error", () => pipe.close());
      child.on("close", (code) =>
        pipe.close(new Error(`preview-fixture-exit-${code}: ${fixtureError}`)),
      );
      try {
        await expect
          .poll(
            async () => (await pipe.call<Status>({ type: "status" })).frames,
            { timeout: 15000 },
          )
          .toBeGreaterThanOrEqual(fps);
        const before = await pipe.call<Status>({ type: "status" });
        assert.equal(before.previewFrames, 0);
        for (let cycle = 0; cycle < 2; cycle++) {
          const offer = await pipe.call<{ sdp: string }>({ type: "offer" });
          const candidates = offer.sdp
            .split(/\r?\n/)
            .filter((line) => line.startsWith("a=candidate:"));
          assert(
            candidates.length > 0 &&
              candidates.every((line) => line.split(/\s+/)[4] === "127.0.0.1"),
          );
          assert(!offer.sdp.includes("m=audio"));
          const answer = await page.evaluate(async (sdp) => {
            const peer = new RTCPeerConnection({ iceServers: [] });
            const video = document.createElement("video");
            video.autoplay = true;
            video.muted = true;
            video.playsInline = true;
            video.setAttribute("aria-label", "Native preview integration");
            document.body.append(video);
            Object.assign(window, { nativeStreamTest: { peer, video } });
            peer.ontrack = (event) => {
              video.srcObject = new MediaStream([event.track]);
              void video.play();
            };
            await peer.setRemoteDescription({ type: "offer", sdp });
            const answer = await peer.createAnswer();
            answer.sdp = answer.sdp!.replaceAll(
              "a=setup:active",
              "a=setup:passive",
            );
            await peer.setLocalDescription(answer);
            if (peer.iceGatheringState !== "complete")
              await new Promise<void>((resolve) => {
                const timer = setTimeout(resolve, 1500);
                peer.onicegatheringstatechange = () => {
                  if (peer.iceGatheringState === "complete") {
                    clearTimeout(timer);
                    resolve();
                  }
                };
              });
            return peer.localDescription!.sdp;
          }, offer.sdp);
          await pipe.call({ type: "answer", sdp: answer });
          const video = page.locator(
            'video[aria-label="Native preview integration"]',
          );
          try {
            await expect
              .poll(
                () =>
                  video.evaluate(
                    (video) =>
                      (video as HTMLVideoElement).getVideoPlaybackQuality()
                        .totalVideoFrames,
                  ),
                { timeout: 10000 },
              )
              .toBeGreaterThanOrEqual(fps / 2);
          } catch (error) {
            const receiver = await page.evaluate(async () => {
              const { peer, video } = (
                window as unknown as {
                  nativeStreamTest: {
                    peer: RTCPeerConnection;
                    video: HTMLVideoElement;
                  };
                }
              ).nativeStreamTest;
              const rows: Record<string, unknown>[] = [];
              (await peer.getStats()).forEach((row) => {
                if (
                  !["transport", "candidate-pair", "inbound-rtp"].includes(
                    row.type,
                  )
                )
                  return;
                const safe: Record<string, unknown> = { type: row.type };
                for (const key of [
                  "state",
                  "dtlsState",
                  "iceState",
                  "nominated",
                  "bytesSent",
                  "bytesReceived",
                  "packetsReceived",
                  "packetsLost",
                  "framesReceived",
                  "framesDecoded",
                  "keyFramesDecoded",
                  "requestsSent",
                  "requestsReceived",
                  "responsesSent",
                  "responsesReceived",
                ])
                  if (row[key] !== undefined) safe[key] = row[key];
                rows.push(safe);
              });
              return {
                connection: peer.connectionState,
                ice: peer.iceConnectionState,
                signaling: peer.signalingState,
                readyState: video.readyState,
                paused: video.paused,
                error: video.error?.code,
                rows,
              };
            });
            console.error(
              "Local preview receive failure:",
              JSON.stringify({
                fps,
                native: await pipe.call({ type: "status" }),
                receiver,
                fixtureError,
              }),
            );
            throw error;
          }
          const measurement = await page.evaluate(async () => {
            const { peer, video } = (
              window as unknown as {
                nativeStreamTest: {
                  peer: RTCPeerConnection;
                  video: HTMLVideoElement;
                };
              }
            ).nativeStreamTest;
            const read = async () => {
              let frames = 0;
              const stats = await peer.getStats();
              stats.forEach((row) => {
                if (row.type === "inbound-rtp" && row.kind === "video")
                  frames = row.framesDecoded;
              });
              return {
                frames,
                at: performance.now(),
                displayed: video.getVideoPlaybackQuality().totalVideoFrames,
              };
            };
            const first = await read(),
              colors = new Set<string>(),
              pixels: number[][] = [];
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const context = canvas.getContext("2d")!;
            for (let i = 0; i < 12; i++) {
              await new Promise((resolve) => setTimeout(resolve, 250));
              context.drawImage(video, 0, 0, 1, 1);
              const pixel = context.getImageData(0, 0, 1, 1).data;
              pixels.push(Array.from(pixel));
              colors.add(pixel[0]! > pixel[2]! ? "red" : "blue");
            }
            const last = await read();
            return {
              width: video.videoWidth,
              height: video.videoHeight,
              decodedFps:
                ((last.frames - first.frames) * 1000) / (last.at - first.at),
              displayedFps:
                ((last.displayed - first.displayed) * 1000) /
                (last.at - first.at),
              colors: colors.size,
              pixels,
              audioTracks: (video.srcObject as MediaStream).getAudioTracks()
                .length,
            };
          });
          assert.equal(measurement.width, 1920);
          assert.equal(measurement.height, 1080);
          assert(
            measurement.decodedFps >= fps * 0.85,
            JSON.stringify(measurement),
          );
          assert(
            measurement.displayedFps >= fps * 0.85,
            JSON.stringify(measurement),
          );
          assert.equal(
            measurement.colors,
            2,
            JSON.stringify({
              measurement,
              native: await pipe.call({ type: "status" }),
            }),
          );
          assert.equal(measurement.audioTracks, 0);
          const externalBefore = (await (
            await fetch(`http://127.0.0.1:${port}/stats`)
          ).json()) as { frames: number };
          await page.evaluate(() => {
            const { peer, video } = (
              window as unknown as {
                nativeStreamTest: {
                  peer: RTCPeerConnection;
                  video: HTMLVideoElement;
                };
              }
            ).nativeStreamTest;
            peer.close();
            (video.srcObject as MediaStream)
              .getTracks()
              .forEach((track) => track.stop());
            video.pause();
            video.srcObject = null;
            video.remove();
          });
          const paused = await pipe.call<Status>({ type: "pause" });
          assert.equal(paused.previewActive, false);
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const after = await pipe.call<Status>({ type: "status" });
          assert.equal(after.previewFrames, paused.previewFrames);
          assert.equal(after.active, true);
          assert(after.frames - paused.frames >= fps * 0.85);
          const externalAfter = (await (
            await fetch(`http://127.0.0.1:${port}/stats`)
          ).json()) as { frames: number };
          assert(externalAfter.frames - externalBefore.frames >= fps * 0.85);
          results.push({
            fps,
            cycle,
            ...measurement,
            publisherFramesWhilePaused: after.frames - paused.frames,
            externalFramesWhilePaused:
              externalAfter.frames - externalBefore.frames,
          });
        }
        await pipe.call({ type: "shutdown" });
      } finally {
        child.kill();
      }
    }
    console.log(
      "Original-quality local preview, decoder pause/resume and independent publication:",
      JSON.stringify(results),
    );
    return results;
  } finally {
    receiver.kill();
  }
}
