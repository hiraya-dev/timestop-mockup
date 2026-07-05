import {
  getToolcraftImageExportSize,
  getToolcraftVideoExportSize,
  type ToolcraftRetinaExportSize,
  type ToolcraftState,
} from "@/toolcraft/runtime";

const GIF_MAX_LONG_EDGE = 2048;
const VIDEO_EXPORT_FPS = 30;

function roundVideoDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function fitExportSizeWithinEncoderMax(
  exportSize: ToolcraftRetinaExportSize,
  encoderMax: ToolcraftRetinaExportSize,
  cssWidth: number,
  cssHeight: number,
): ToolcraftRetinaExportSize {
  const scale = Math.min(
    1,
    encoderMax.width / exportSize.width,
    encoderMax.height / exportSize.height,
  );

  if (scale >= 1) {
    return {
      height: roundVideoDimension(exportSize.height),
      pixelRatio: exportSize.pixelRatio,
      width: roundVideoDimension(exportSize.width),
    };
  }

  const width = roundVideoDimension(exportSize.width * scale);
  const height = roundVideoDimension(exportSize.height * scale);

  return {
    height,
    pixelRatio: Math.max(width / cssWidth, height / cssHeight),
    width,
  };
}

export function getSceneAnimatedExportSize(state: ToolcraftState): ToolcraftRetinaExportSize {
  const cssWidth = Math.max(1, state.canvas.size.width);
  const cssHeight = Math.max(1, state.canvas.size.height);
  const videoResolution = String(state.values["export.video.resolution"] ?? "current").toLowerCase();
  const encoderMax = getToolcraftVideoExportSize({ resolution: "4k", state });

  if (videoResolution === "4k") {
    return encoderMax;
  }

  const imageResolution = String(state.values["export.image.resolution"] ?? "4k");

  return fitExportSizeWithinEncoderMax(
    getToolcraftImageExportSize({ resolution: imageResolution, state }),
    encoderMax,
    cssWidth,
    cssHeight,
  );
}

export function getSceneGifExportSize(state: ToolcraftState): ToolcraftRetinaExportSize {
  const exportSize = getSceneAnimatedExportSize(state);
  const cssWidth = Math.max(1, state.canvas.size.width);
  const cssHeight = Math.max(1, state.canvas.size.height);
  const dominantEdge = Math.max(exportSize.width, exportSize.height);
  const cappedDominantEdge = Math.min(dominantEdge, GIF_MAX_LONG_EDGE);
  const pixelRatio = cappedDominantEdge / Math.max(cssWidth, cssHeight);

  return {
    height: Math.max(2, Math.round(cssHeight * pixelRatio)),
    pixelRatio,
    width: Math.max(2, Math.round(cssWidth * pixelRatio)),
  };
}

export function getVideoFrameTimesSeconds(durationSeconds: number): number[] {
  const safeDuration = Math.max(0.2, durationSeconds);
  const sampleCount = Math.max(2, Math.round(safeDuration * VIDEO_EXPORT_FPS));

  return Array.from(
    { length: sampleCount },
    (unused, index) => (index / sampleCount) * safeDuration,
  );
}

export function getVideoExportBitrate(width: number, height: number): number {
  const pixels = width * height;

  return Math.max(16_000_000, Math.min(50_000_000, Math.round(pixels * 0.1)));
}

export { VIDEO_EXPORT_FPS };
