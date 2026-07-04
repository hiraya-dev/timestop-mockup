import { GIFEncoder, nearestColorIndex, quantize, type GifPalette } from "gifenc";

import {
  getToolcraftVideoExportSize,
  shouldIncludeToolcraftExportBackground,
  type ToolcraftState,
} from "@/toolcraft/runtime";

import { drawScene, getSceneSettings, loadSceneImages, type SceneSettings } from "./scene";

const GIF_CROSSFADE_FPS = 20;
const GIF_MAX_LONG_EDGE = 1600;

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

// GIF's 256-color palette bands smooth gradients (e.g. a blurred background)
// into flat, blobby regions when colors snap to the nearest palette entry.
// Floyd-Steinberg error diffusion spreads each pixel's quantization error to
// its neighbors, breaking the bands up into a fine dither pattern that reads
// as smooth at normal viewing distance.
function ditherToPalette(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: GifPalette,
  paletteLut: Uint8Array,
): Uint8Array {
  const indices = new Uint8Array(width * height);
  const buffer = new Float32Array(rgba.length);

  for (let i = 0; i < rgba.length; i++) {
    buffer[i] = rgba[i];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = clampByte(buffer[i]);
      const g = clampByte(buffer[i + 1]);
      const b = clampByte(buffer[i + 2]);
      const index = paletteLut[packRgb565(r, g, b)];

      indices[y * width + x] = index;

      const paletteColor = palette[index];
      const errorR = r - paletteColor[0];
      const errorG = g - paletteColor[1];
      const errorB = b - paletteColor[2];

      diffuseError(buffer, width, height, x + 1, y, errorR, errorG, errorB, 7 / 16);
      diffuseError(buffer, width, height, x - 1, y + 1, errorR, errorG, errorB, 3 / 16);
      diffuseError(buffer, width, height, x, y + 1, errorR, errorG, errorB, 5 / 16);
      diffuseError(buffer, width, height, x + 1, y + 1, errorR, errorG, errorB, 1 / 16);
    }
  }

  return indices;
}

function diffuseError(
  buffer: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  errorR: number,
  errorG: number,
  errorB: number,
  factor: number,
): void {
  if (x < 0 || x >= width || y >= height) return;

  const i = (y * width + x) * 4;

  buffer[i] += errorR * factor;
  buffer[i + 1] += errorG * factor;
  buffer[i + 2] += errorB * factor;
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
  const currentSize = getToolcraftVideoExportSize({ resolution: "current", state });
  const downScale = Math.min(
    1,
    GIF_MAX_LONG_EDGE / Math.max(currentSize.width, currentSize.height),
  );
  const width = Math.max(2, Math.round(currentSize.width * downScale));
  const height = Math.max(2, Math.round(currentSize.height * downScale));

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
  const frameTimes = getGifFrameTimesSeconds(
    durationSeconds,
    settings.frames.length,
    settings.transition,
  );
  const delayMs = Math.max(20, Math.round((durationSeconds * 1000) / frameTimes.length));
  const encoder = GIFEncoder();

  for (const [index, timeSeconds] of frameTimes.entries()) {
    context.clearRect(0, 0, width, height);
    context.fillStyle = settings.backgroundColor;
    context.fillRect(0, 0, width, height);
    drawScene({
      context,
      height,
      loopProgress: (timeSeconds % durationSeconds) / durationSeconds,
      settings,
      width,
    });

    const data = pixelReader.readPixels(canvas);
    const palette = quantize(data, 256);
    const paletteLut = buildRgb565PaletteLut(palette);
    const indexed = ditherToPalette(data, width, height, palette, paletteLut);

    encoder.writeFrame(indexed, width, height, { delay: delayMs, palette });
    reportProgress(0.05 + (0.9 * (index + 1)) / frameTimes.length);

    // Yield so the export progress indicator can paint between frames.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  pixelReader.dispose();
  encoder.finish();

  const gifBytes = encoder.bytesView();
  const gifBuffer = new ArrayBuffer(gifBytes.byteLength);

  new Uint8Array(gifBuffer).set(gifBytes);

  const blob = new Blob([gifBuffer], { type: "image/gif" });

  reportProgress(1);
  downloadBlob(blob, "layered-showcase.gif");

  return blob;
}
