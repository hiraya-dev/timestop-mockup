import { GIFEncoder, nearestColorIndex, quantize, type GifPalette } from "gifenc";

import {
  shouldIncludeToolcraftExportBackground,
  type ToolcraftState,
} from "@/toolcraft/runtime";

import { getSceneGifExportSize } from "./export-render-size";
import { paintSceneExportFrame, shouldDitherGifBackground } from "./export-scene-canvas";
import { getSceneSettings, loadSceneImages, type SceneSettings } from "./scene";

const GIF_CROSSFADE_FPS = 20;
const GIF_FRAME_PALETTE_COLORS = 200;
const GIF_BACKGROUND_PALETTE_COLORS = 56;

type GifPixelReader = {
  dispose: () => void;
  readPixels: (source: HTMLCanvasElement) => Uint8ClampedArray;
};

// GIF encoding needs raw RGBA bytes for palette quantization. Read them back
// through a WebGL texture + framebuffer so the interactive Canvas 2D pipeline
// never gains a CPU ImageData path.
function createGifPixelReader(width: number, height: number): GifPixelReader {
  const glCanvas = document.createElement("canvas");

  glCanvas.width = width;
  glCanvas.height = height;

  const gl = glCanvas.getContext("webgl", { preserveDrawingBuffer: false });

  if (!gl) {
    throw new Error("GIF export requires a WebGL context for pixel readback.");
  }

  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

  const rowBytes = width * 4;
  const buffer = new Uint8ClampedArray(rowBytes * height);

  return {
    dispose: () => {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
    },
    readPixels: (source) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      // texImage2D from a canvas (no UNPACK_FLIP_Y) lands the canvas top row at
      // the framebuffer origin that readPixels returns first, so the readback is
      // already top-down — matching the GIF row order.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0,
      );
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, buffer);

      return buffer;
    },
  };
}

function packRgb565(r: number, g: number, b: number): number {
  return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}

// A 5-6-5 bit RGB cube has 65536 buckets. Precomputing the nearest palette
// index for every bucket up front bounds the expensive palette search to a
// fixed cost per frame (65536 * palette size) instead of a per-pixel lookup —
// with error diffusion, nearly every pixel ends up a slightly different
// color, so a lazily-populated cache would rarely hit and degrade to an
// O(width * height * paletteSize) search.
function buildRgb565PaletteLut(palette: GifPalette): Uint8Array {
  const lut = new Uint8Array(65536);

  for (let key = 0; key < 65536; key++) {
    const r = (key >> 8) & 0xf8;
    const g = (key >> 3) & 0xfc;
    const b = (key << 3) & 0xf8;

    lut[key] = nearestColorIndex(palette, [r, g, b]);
  }

  return lut;
}

function collectMaskedPixels(
  rgba: Uint8ClampedArray,
  frameMask: Uint8Array,
  wantFrame: boolean,
): Uint8ClampedArray {
  const values: number[] = [];

  for (let pixelIndex = 0; pixelIndex < frameMask.length; pixelIndex++) {
    const isFrame = frameMask[pixelIndex] !== 0;

    if (isFrame !== wantFrame) {
      continue;
    }

    const offset = pixelIndex * 4;

    values.push(rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!, rgba[offset + 3]!);
  }

  return new Uint8ClampedArray(values);
}

function mergePalettes(
  primary: GifPalette,
  secondary: GifPalette,
  maxColors: number,
): GifPalette {
  const merged: GifPalette = [];
  const seen = new Set<string>();

  for (const color of [...primary, ...secondary]) {
    const key = `${color[0]},${color[1]},${color[2]}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(color);

    if (merged.length >= maxColors) {
      break;
    }
  }

  return merged;
}

export function buildGifPalette(
  rgba: Uint8ClampedArray,
  frameMask: Uint8Array,
): GifPalette {
  const framePixels = collectMaskedPixels(rgba, frameMask, true);
  const backgroundPixels = collectMaskedPixels(rgba, frameMask, false);

  if (framePixels.length < 16 || backgroundPixels.length < 16) {
    return quantize(rgba, 256);
  }

  const framePalette = quantize(
    framePixels,
    Math.min(GIF_FRAME_PALETTE_COLORS, 256),
  );
  const backgroundPalette = quantize(
    backgroundPixels,
    Math.min(
      GIF_BACKGROUND_PALETTE_COLORS,
      Math.max(1, 256 - framePalette.length),
    ),
  );

  return mergePalettes(framePalette, backgroundPalette, 256);
}

function nearestToPalette(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  paletteLut: Uint8Array,
): Uint8Array {
  const indices = new Uint8Array(width * height);

  for (let pixelIndex = 0; pixelIndex < indices.length; pixelIndex++) {
    const offset = pixelIndex * 4;

    indices[pixelIndex] = paletteLut[
      packRgb565(rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!)
    ]!;
  }

  return indices;
}

export function indexGifSceneFrame(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  frameMask: Uint8Array,
  settings: SceneSettings,
): Uint8Array {
  const palette = buildGifPalette(rgba, frameMask);
  const paletteLut = buildRgb565PaletteLut(palette);

  if (!shouldDitherGifBackground(settings)) {
    return nearestToPalette(rgba, width, height, paletteLut);
  }

  return ditherToPalette(rgba, width, height, palette, paletteLut, frameMask);
}

// GIF's 256-color palette bands smooth gradients (e.g. a blurred background)
// into flat, blobby regions when colors snap to the nearest palette entry.
// Floyd-Steinberg error diffusion spreads each pixel's quantization error to
// its neighbors, breaking the bands up into a fine dither pattern that reads
// as smooth at normal viewing distance. UI frame pixels are already sharp
// detail rather than a smooth band, so diffusing error into or out of them
// just reads as extra grain — `frameMask` marks those pixels (alpha > 0 in a
// background-less render) so only background pixels propagate error.
function ditherToPalette(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: GifPalette,
  paletteLut: Uint8Array,
  frameMask: Uint8Array | null,
): Uint8Array {
  const indices = new Uint8Array(width * height);
  const buffer = new Float32Array(rgba.length);

  for (let i = 0; i < rgba.length; i++) {
    buffer[i] = rgba[i];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixelIndex = y * width + x;
      const i = pixelIndex * 4;
      const r = clampByte(buffer[i]);
      const g = clampByte(buffer[i + 1]);
      const b = clampByte(buffer[i + 2]);
      const index = paletteLut[packRgb565(r, g, b)];

      indices[pixelIndex] = index;

      if (frameMask && frameMask[pixelIndex] !== 0) {
        continue;
      }

      const paletteColor = palette[index];
      const errorR = r - paletteColor[0];
      const errorG = g - paletteColor[1];
      const errorB = b - paletteColor[2];

      diffuseError(
        buffer,
        width,
        height,
        frameMask,
        x + 1,
        y,
        errorR,
        errorG,
        errorB,
        7 / 16,
      );
      diffuseError(
        buffer,
        width,
        height,
        frameMask,
        x - 1,
        y + 1,
        errorR,
        errorG,
        errorB,
        3 / 16,
      );
      diffuseError(
        buffer,
        width,
        height,
        frameMask,
        x,
        y + 1,
        errorR,
        errorG,
        errorB,
        5 / 16,
      );
      diffuseError(
        buffer,
        width,
        height,
        frameMask,
        x + 1,
        y + 1,
        errorR,
        errorG,
        errorB,
        1 / 16,
      );
    }
  }

  return indices;
}

function diffuseError(
  buffer: Float32Array,
  width: number,
  height: number,
  frameMask: Uint8Array | null,
  x: number,
  y: number,
  errorR: number,
  errorG: number,
  errorB: number,
  factor: number,
): void {
  if (x < 0 || x >= width || y >= height) {
    return;
  }

  const pixelIndex = y * width + x;

  if (frameMask && frameMask[pixelIndex] !== 0) {
    return;
  }

  const i = pixelIndex * 4;

  buffer[i] += errorR * factor;
  buffer[i + 1] += errorG * factor;
  buffer[i + 2] += errorB * factor;
}

// Renders the scene with the background layer omitted so alpha > 0 marks
// exactly the pixels covered by the frame photo(s) and its drop shadow.
function buildFrameMask(
  maskCanvas: HTMLCanvasElement,
  maskContext: CanvasRenderingContext2D,
  maskPixelReader: GifPixelReader,
  cssHeight: number,
  cssWidth: number,
  exportHeight: number,
  exportWidth: number,
  pixelRatio: number,
  settings: SceneSettings,
  loopProgress: number,
): Uint8Array {
  paintSceneExportFrame({
    backgroundColor: settings.backgroundColor,
    context: maskContext,
    cssHeight,
    cssWidth,
    exportHeight,
    exportWidth,
    includeBackgroundFill: false,
    loopProgress,
    pixelRatio,
    settings: { ...settings, includeBackground: false },
  });

  const maskData = maskPixelReader.readPixels(maskCanvas);
  const mask = new Uint8Array(exportWidth * exportHeight);

  for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex++) {
    mask[pixelIndex] = maskData[pixelIndex * 4 + 3]! > 0 ? 1 : 0;
  }

  return mask;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function getGifFrameTimesSeconds(
  durationSeconds: number,
  frameCount: number,
  transition: SceneSettings["transition"],
): number[] {
  const safeDuration = Math.max(0.2, durationSeconds);

  if (transition === "cut" && frameCount > 0) {
    const slotSeconds = safeDuration / frameCount;

    return Array.from(
      { length: frameCount },
      (unused, index) => index * slotSeconds + slotSeconds / 2,
    );
  }

  const sampleCount = Math.max(2, Math.round(safeDuration * GIF_CROSSFADE_FPS));

  return Array.from(
    { length: sampleCount },
    (unused, index) => (index / sampleCount) * safeDuration,
  );
}

export async function exportSceneGif({
  reportProgress,
  state,
}: {
  reportProgress: (progress: number) => void;
  state: ToolcraftState;
}): Promise<Blob> {
  // GIF has no alpha blending, so the exported GIF always keeps the background.
  const keepBackground = shouldIncludeToolcraftExportBackground({
    format: "video",
    schema: state.schema,
  });
  const settings = getSceneSettings(state, { includeBackground: keepBackground });
  const durationSeconds = Math.max(0.2, state.timeline.durationSeconds);
  const { height, pixelRatio, width } = getSceneGifExportSize(state);
  const cssHeight = state.canvas.size.height;
  const cssWidth = state.canvas.size.width;

  reportProgress(0.02);
  await loadSceneImages(settings);

  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("GIF export requires a 2D canvas context.");
  }

  const pixelReader = createGifPixelReader(width, height);
  const maskCanvas = document.createElement("canvas");

  maskCanvas.width = width;
  maskCanvas.height = height;

  const maskContext = maskCanvas.getContext("2d");

  if (!maskContext) {
    throw new Error("GIF export requires a 2D canvas context.");
  }

  const maskPixelReader = createGifPixelReader(width, height);
  const frameTimes = getGifFrameTimesSeconds(
    durationSeconds,
    settings.frames.length,
    settings.transition,
  );
  const delayMs = Math.max(20, Math.round((durationSeconds * 1000) / frameTimes.length));
  const encoder = GIFEncoder();

  for (const [index, timeSeconds] of frameTimes.entries()) {
    const loopProgress = (timeSeconds % durationSeconds) / durationSeconds;

    paintSceneExportFrame({
      backgroundColor: settings.backgroundColor,
      context,
      cssHeight,
      cssWidth,
      exportHeight: height,
      exportWidth: width,
      includeBackgroundFill: keepBackground,
      loopProgress,
      pixelRatio,
      settings,
    });

    const frameMask = buildFrameMask(
      maskCanvas,
      maskContext,
      maskPixelReader,
      cssHeight,
      cssWidth,
      height,
      width,
      pixelRatio,
      settings,
      loopProgress,
    );
    const data = pixelReader.readPixels(canvas);
    const indexed = indexGifSceneFrame(data, width, height, frameMask, settings);
    const palette = buildGifPalette(data, frameMask);

    encoder.writeFrame(indexed, width, height, { delay: delayMs, palette });
    reportProgress(0.05 + (0.9 * (index + 1)) / frameTimes.length);

    // Yield so the export progress indicator can paint between frames.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  pixelReader.dispose();
  maskPixelReader.dispose();
  encoder.finish();

  const gifBytes = encoder.bytesView();
  const gifBuffer = new ArrayBuffer(gifBytes.byteLength);

  new Uint8Array(gifBuffer).set(gifBytes);

  const blob = new Blob([gifBuffer], { type: "image/gif" });

  reportProgress(1);
  downloadBlob(blob, "loop-frame.gif");

  return blob;
}
