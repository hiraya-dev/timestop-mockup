import {
  getToolcraftVideoExportSize,
  shouldIncludeToolcraftExportBackground,
  type ToolcraftState,
} from "@/toolcraft/runtime";

import { drawScene, getSceneSettings, loadSceneImages } from "./scene";

type VideoMimeCandidate = {
  extension: string;
  mimeType: string;
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

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

const VIDEO_EXPORT_FPS = 30;

export async function exportSceneVideo({
  reportProgress,
  state,
}: {
  reportProgress: (progress: number) => void;
  state: ToolcraftState;
}): Promise<Blob> {
  // Video export always keeps the product background.
  const keepBackground = shouldIncludeToolcraftExportBackground({
    format: "video",
    schema: state.schema,
  });
  const settings = getSceneSettings(state, { includeBackground: keepBackground });
  const format = String(state.values["export.video.format"] ?? "mp4");
  const resolution = String(state.values["export.video.resolution"] ?? "current");
  const durationSeconds = Math.max(0.2, state.timeline.durationSeconds);
  const { height, width } = getToolcraftVideoExportSize({ resolution, state });

  reportProgress(0.02);
  await loadSceneImages(settings);

  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Video export requires a 2D canvas context.");
  }

  const mime = pickSupportedVideoMime(format);
  const stream = canvas.captureStream(VIDEO_EXPORT_FPS);
  const recorder = new MediaRecorder(stream, {
    mimeType: mime.mimeType,
    videoBitsPerSecond: 12_000_000,
  });
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const paintAtTime = (timeSeconds: number) => {
    context.clearRect(0, 0, width, height);
    drawScene({
      context,
      height,
      loopProgress: (timeSeconds % durationSeconds) / durationSeconds,
      settings,
      width,
    });
  };

  paintAtTime(0);

  const totalFrames = Math.max(2, Math.round(durationSeconds * VIDEO_EXPORT_FPS));

  return new Promise<Blob>((resolve, reject) => {
    recorder.onerror = (event) => {
      reject(
        event instanceof ErrorEvent
          ? event.error
          : new Error("Video export recorder failed."),
      );
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mime.mimeType.split(";")[0] });

      if (blob.size === 0) {
        reject(new Error("Video export produced no data."));

        return;
      }

      reportProgress(1);
      downloadBlob(blob, `layered-gif.${mime.extension}`);
      resolve(blob);
    };

    recorder.start(100);

    const startedAt = performance.now();
    const tick = () => {
      const elapsedSeconds = (performance.now() - startedAt) / 1000;

      if (elapsedSeconds >= durationSeconds) {
        paintAtTime(durationSeconds - 1 / VIDEO_EXPORT_FPS);
        recorder.stop();

        return;
      }

      paintAtTime(elapsedSeconds);
      reportProgress(
        Math.min(
          0.95,
          0.05 + (0.9 * Math.min(elapsedSeconds * VIDEO_EXPORT_FPS, totalFrames)) / totalFrames,
        ),
      );
      requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });
}
