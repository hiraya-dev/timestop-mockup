import {
  shouldIncludeToolcraftExportBackground,
  type ToolcraftState,
} from "@/toolcraft/runtime";

import {
  getSceneAnimatedExportSize,
  getVideoExportBitrate,
  getVideoFrameTimesSeconds,
  VIDEO_EXPORT_FPS,
} from "./export-render-size";
import { paintSceneExportFrame } from "./export-scene-canvas";
import { getSceneSettings, loadSceneImages } from "./scene";

type VideoMimeCandidate = {
  extension: string;
  mimeType: string;
};

type CanvasCaptureTrack = MediaStreamTrack & {
  requestFrame?: () => void;
};

const videoMimeCandidatesByFormat: Record<string, VideoMimeCandidate[]> = {
  mp4: [
    { extension: "mp4", mimeType: "video/mp4;codecs=avc1.42E01E" },
    { extension: "mp4", mimeType: "video/mp4" },
    { extension: "webm", mimeType: "video/webm;codecs=vp9" },
    { extension: "webm", mimeType: "video/webm" },
  ],
  webm: [
    { extension: "webm", mimeType: "video/webm;codecs=vp9" },
    { extension: "webm", mimeType: "video/webm" },
    { extension: "mp4", mimeType: "video/mp4" },
  ],
};

export function pickSupportedVideoMime(
  format: string,
  isTypeSupported: (mimeType: string) => boolean = (mimeType) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType),
): VideoMimeCandidate {
  const candidates =
    videoMimeCandidatesByFormat[format] ?? videoMimeCandidatesByFormat.mp4;

  for (const candidate of candidates) {
    if (isTypeSupported(candidate.mimeType)) {
      return candidate;
    }
  }

  return { extension: "webm", mimeType: "video/webm" };
}

export function supportsManualCanvasFrameCapture(
  track: MediaStreamTrack | undefined,
): track is CanvasCaptureTrack {
  if (!track) {
    return false;
  }

  return typeof (track as CanvasCaptureTrack).requestFrame === "function";
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function createVideoRecorder(
  stream: MediaStream,
  mimeType: string,
  videoBitsPerSecond: number,
): MediaRecorder {
  const bitrates = [videoBitsPerSecond, Math.round(videoBitsPerSecond * 0.6), 8_000_000];

  for (const bitrate of bitrates) {
    try {
      return new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: bitrate,
      });
    } catch {
      // Try a lower bitrate or let the next candidate mime type handle it.
    }
  }

  return new MediaRecorder(stream, { mimeType });
}

function recordVideoFromStream({
  durationSeconds,
  exportHeight,
  exportWidth,
  frameTimes,
  mime,
  onFrame,
  reportProgress,
  stream,
  useManualFrameCapture,
}: {
  durationSeconds: number;
  exportHeight: number;
  exportWidth: number;
  frameTimes: number[];
  mime: VideoMimeCandidate;
  onFrame: (timeSeconds: number) => void;
  reportProgress: (progress: number) => void;
  stream: MediaStream;
  useManualFrameCapture: boolean;
}): Promise<Blob> {
  const track = stream.getVideoTracks()[0] as CanvasCaptureTrack | undefined;
  const recorder = createVideoRecorder(
    stream,
    mime.mimeType,
    getVideoExportBitrate(exportWidth, exportHeight),
  );
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  return new Promise<Blob>((resolve, reject) => {
    recorder.onerror = (event) => {
      reject(
        event instanceof ErrorEvent
          ? event.error ?? new Error("Video export recorder failed.")
          : new Error("Video export recorder failed."),
      );
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime.mimeType.split(";")[0] });

      if (blob.size === 0) {
        reject(new Error("Video export produced no data."));

        return;
      }

      resolve(blob);
    };

    try {
      recorder.start(100);
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Video export recorder failed to start."));

      return;
    }

    void (async () => {
      try {
        if (useManualFrameCapture && supportsManualCanvasFrameCapture(track)) {
          const frameDelayMs = 1000 / VIDEO_EXPORT_FPS;

          for (const [index, timeSeconds] of frameTimes.entries()) {
            onFrame(timeSeconds);
            track.requestFrame!();
            reportProgress(0.05 + (0.9 * (index + 1)) / frameTimes.length);
            await wait(frameDelayMs);
          }

          onFrame(Math.max(0, durationSeconds - 1 / VIDEO_EXPORT_FPS));
          track.requestFrame!();
          await wait(frameDelayMs);
          recorder.stop();

          return;
        }

        const startedAt = performance.now();

        onFrame(0);

        await new Promise<void>((resolveRealtime, rejectRealtime) => {
          const tick = () => {
            const elapsedSeconds = (performance.now() - startedAt) / 1000;

            if (elapsedSeconds >= durationSeconds) {
              onFrame(Math.max(0, durationSeconds - 1 / VIDEO_EXPORT_FPS));
              recorder.stop();
              resolveRealtime();

              return;
            }

            onFrame(elapsedSeconds);
            reportProgress(
              Math.min(
                0.95,
                0.05 +
                  (0.9 * Math.min(elapsedSeconds * VIDEO_EXPORT_FPS, frameTimes.length)) /
                    frameTimes.length,
              ),
            );
            requestAnimationFrame(tick);
          };

          requestAnimationFrame(tick);
        });
      } catch (error) {
        try {
          if (recorder.state !== "inactive") {
            recorder.stop();
          }
        } catch {
          // Ignore cleanup failures after a primary export error.
        }

        reject(error instanceof Error ? error : new Error("Video export failed."));
      }
    })();
  });
}

export async function exportSceneVideo({
  reportProgress,
  state,
}: {
  reportProgress: (progress: number) => void;
  state: ToolcraftState;
}): Promise<Blob> {
  const keepBackground = shouldIncludeToolcraftExportBackground({
    format: "video",
    schema: state.schema,
  });
  const settings = getSceneSettings(state, { includeBackground: keepBackground });
  const format = String(state.values["export.video.format"] ?? "mp4");
  const durationSeconds = Math.max(0.2, state.timeline.durationSeconds);
  const { height, pixelRatio, width } = getSceneAnimatedExportSize(state);
  const cssHeight = state.canvas.size.height;
  const cssWidth = state.canvas.size.width;

  reportProgress(0.02);
  await loadSceneImages(settings);

  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { alpha: false });

  if (!context) {
    throw new Error("Video export requires a 2D canvas context.");
  }

  const mime = pickSupportedVideoMime(format);
  const manualTrackProbe = canvas.captureStream(0).getVideoTracks()[0];
  const useManualFrameCapture = supportsManualCanvasFrameCapture(manualTrackProbe);
  manualTrackProbe.stop();

  const stream = canvas.captureStream(useManualFrameCapture ? 0 : VIDEO_EXPORT_FPS);
  const frameTimes = getVideoFrameTimesSeconds(durationSeconds);

  const paintAtTime = (timeSeconds: number) => {
    paintSceneExportFrame({
      backgroundColor: settings.backgroundColor,
      context,
      cssHeight,
      cssWidth,
      exportHeight: height,
      exportWidth: width,
      includeBackgroundFill: keepBackground,
      loopProgress: (timeSeconds % durationSeconds) / durationSeconds,
      pixelRatio,
      settings,
    });
  };

  const blob = await recordVideoFromStream({
    durationSeconds,
    exportHeight: height,
    exportWidth: width,
    frameTimes,
    mime,
    onFrame: paintAtTime,
    reportProgress,
    stream,
    useManualFrameCapture,
  });

  stream.getTracks().forEach((track) => track.stop());
  reportProgress(1);
  downloadBlob(blob, `loop-frame.${mime.extension}`);

  return blob;
}
