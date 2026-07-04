import type { ToolcraftMediaAsset, ToolcraftState } from "@/toolcraft/runtime";

export type SceneGradientStop = {
  color: string;
  opacity: number;
  position: number;
};

export type SceneGradient = {
  angle: number;
  gradientType: string;
  stops: SceneGradientStop[];
};

export type SceneFrameAsset = {
  dataUrl: string;
  id: string;
  transform?: {
    flipHorizontal?: boolean;
    flipVertical?: boolean;
    rotationDeg?: 0 | 90 | 180 | 270;
  };
};

export type SceneSettings = {
  backgroundBlur: number;
  backgroundColor: string;
  backgroundGradient: SceneGradient | null;
  backgroundImage: SceneFrameAsset | null;
  backgroundMode: "gradient" | "image" | "solid";
  cornerRadius: number;
  frames: SceneFrameAsset[];
  includeBackground: boolean;
  scale: number;
  shadow: boolean;
  transition: "crossfade" | "cut";
};

export type SceneFrameMix = {
  currentIndex: number;
  nextIndex: number;
  nextAlpha: number;
};

const CROSSFADE_SLOT_FRACTION = 0.35;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toSceneAsset(asset: ToolcraftMediaAsset): SceneFrameAsset {
  return {
    dataUrl: asset.dataUrl,
    id: asset.id,
    transform: asset.transform,
  };
}

export function getSceneFrameAssets(state: ToolcraftState): SceneFrameAsset[] {
  return state.mediaAssets
    .filter((asset) => asset.sourceTarget === "frames.images")
    .map(toSceneAsset);
}

export function getSceneBackgroundAsset(state: ToolcraftState): SceneFrameAsset | null {
  const asset = state.mediaAssets.find(
    (mediaAsset) => mediaAsset.sourceTarget === "background.image",
  );

  return asset ? toSceneAsset(asset) : null;
}

function readGradient(value: unknown): SceneGradient | null {
  if (!isRecord(value) || !Array.isArray(value.stops)) {
    return null;
  }

  const stops = value.stops
    .filter(isRecord)
    .map((stop) => ({
      color: typeof stop.color === "string" ? stop.color : "#000000",
      opacity: typeof stop.opacity === "number" ? stop.opacity : 100,
      position: typeof stop.position === "number" ? stop.position : 0,
    }))
    .sort((a, b) => a.position - b.position);

  if (stops.length === 0) {
    return null;
  }

  return {
    angle: typeof value.angle === "number" ? value.angle : 0,
    gradientType: typeof value.gradientType === "string" ? value.gradientType : "linear",
    stops,
  };
}

function readColorHex(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.hex === "string") {
    return value.hex;
  }

  return typeof value === "string" ? value : fallback;
}

export function getSceneSettings(
  state: ToolcraftState,
  { includeBackground }: { includeBackground: boolean },
): SceneSettings {
  const values = state.values;
  const backgroundModeValue = values["background.mode"];
  const backgroundMode =
    backgroundModeValue === "gradient" || backgroundModeValue === "image"
      ? backgroundModeValue
      : "solid";
  const transition = values["frames.transition"] === "crossfade" ? "crossfade" : "cut";
  const scaleValue = Number(values["frame.scale"]);
  const cornerRadiusValue = Number(values["frame.cornerRadius"]);
  const backgroundBlurValue = Number(values["background.blur"]);

  return {
    backgroundBlur:
      Number.isFinite(backgroundBlurValue) && backgroundBlurValue > 0
        ? backgroundBlurValue
        : 0,
    backgroundColor: readColorHex(values["background.color"], "#111113"),
    backgroundGradient: readGradient(values["background.gradient"]),
    backgroundImage: getSceneBackgroundAsset(state),
    backgroundMode,
    cornerRadius: Number.isFinite(cornerRadiusValue) ? cornerRadiusValue : 16,
    frames: getSceneFrameAssets(state),
    includeBackground,
    scale: Number.isFinite(scaleValue) ? scaleValue : 70,
    shadow: values["frame.shadow"] !== false,
    transition,
  };
}

export function getSceneFrameMix(
  loopProgress: number,
  frameCount: number,
  transition: "crossfade" | "cut",
): SceneFrameMix {
  if (frameCount <= 0) {
    return { currentIndex: 0, nextAlpha: 0, nextIndex: 0 };
  }

  const progress = Math.min(Math.max(loopProgress, 0), 1) % 1;
  const slotPosition = progress * frameCount;
  const currentIndex = Math.min(Math.floor(slotPosition), frameCount - 1);
  const nextIndex = (currentIndex + 1) % frameCount;

  if (transition === "cut" || frameCount === 1) {
    return { currentIndex, nextAlpha: 0, nextIndex };
  }

  const slotProgress = slotPosition - currentIndex;
  const fadeStart = 1 - CROSSFADE_SLOT_FRACTION;
  const nextAlpha =
    slotProgress <= fadeStart ? 0 : (slotProgress - fadeStart) / CROSSFADE_SLOT_FRACTION;

  return { currentIndex, nextAlpha: Math.min(Math.max(nextAlpha, 0), 1), nextIndex };
}

export type SceneImageSource = CanvasImageSource & {
  height: number;
  width: number;
};

export type SceneImageResolver = (asset: SceneFrameAsset) => SceneImageSource | undefined;

const decodedImageCache = new Map<string, HTMLImageElement>();
const pendingImageLoads = new Map<string, Promise<HTMLImageElement>>();

export function getDecodedSceneImage(dataUrl: string): HTMLImageElement | undefined {
  const image = decodedImageCache.get(dataUrl);

  return image && image.complete && image.naturalWidth > 0 ? image : undefined;
}

export function loadSceneImage(dataUrl: string): Promise<HTMLImageElement> {
  const cached = decodedImageCache.get(dataUrl);

  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached);
  }

  const pending = pendingImageLoads.get(dataUrl);

  if (pending) {
    return pending;
  }

  const load = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      decodedImageCache.set(dataUrl, image);
      pendingImageLoads.delete(dataUrl);
      resolve(image);
    };
    image.onerror = () => {
      pendingImageLoads.delete(dataUrl);
      reject(new Error("Failed to decode uploaded image."));
    };
    image.src = dataUrl;
  });

  pendingImageLoads.set(dataUrl, load);

  return load;
}

export async function loadSceneImages(settings: SceneSettings): Promise<void> {
  const dataUrls = settings.frames.map((frame) => frame.dataUrl);

  if (settings.backgroundMode === "image" && settings.backgroundImage) {
    dataUrls.push(settings.backgroundImage.dataUrl);
  }

  await Promise.all(dataUrls.map((dataUrl) => loadSceneImage(dataUrl)));
}

function getTransformedSize(
  image: SceneImageSource,
  transform: SceneFrameAsset["transform"],
): { height: number; width: number } {
  const rotated = transform?.rotationDeg === 90 || transform?.rotationDeg === 270;

  return rotated
    ? { height: image.width, width: image.height }
    : { height: image.height, width: image.width };
}

function drawTransformedImage(
  context: CanvasRenderingContext2D,
  image: SceneImageSource,
  transform: SceneFrameAsset["transform"],
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const rotationDeg = transform?.rotationDeg ?? 0;
  const rotated = rotationDeg === 90 || rotationDeg === 270;
  const drawWidth = rotated ? height : width;
  const drawHeight = rotated ? width : height;

  context.save();
  context.translate(x + width / 2, y + height / 2);
  context.rotate((rotationDeg * Math.PI) / 180);
  context.scale(transform?.flipHorizontal ? -1 : 1, transform?.flipVertical ? -1 : 1);
  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
}

// A reusable low-resolution scratch canvas for the backdrop blur. Blurring a
// downscaled copy and upscaling it keeps blur cost near-constant regardless of
// radius, and the bilinear upscale itself reinforces the soft look.
let blurScratchCanvas: HTMLCanvasElement | null = null;
const BLUR_SCRATCH_MAX_EDGE = 960;

function getBlurScratchContext(
  width: number,
  height: number,
): { context: CanvasRenderingContext2D; scaleDown: number } | null {
  if (typeof document === "undefined") {
    return null;
  }

  const scaleDown = Math.min(1, BLUR_SCRATCH_MAX_EDGE / Math.max(width, height));
  const scratchWidth = Math.max(1, Math.round(width * scaleDown));
  const scratchHeight = Math.max(1, Math.round(height * scaleDown));

  if (!blurScratchCanvas) {
    blurScratchCanvas = document.createElement("canvas");
  }

  blurScratchCanvas.width = scratchWidth;
  blurScratchCanvas.height = scratchHeight;

  const context = blurScratchCanvas.getContext("2d");

  if (!context) {
    return null;
  }

  return { context, scaleDown };
}

function drawBackground(
  context: CanvasRenderingContext2D,
  settings: SceneSettings,
  width: number,
  height: number,
  resolveImage: SceneImageResolver,
): void {
  if (!settings.includeBackground) {
    return;
  }

  if (settings.backgroundMode === "gradient" && settings.backgroundGradient) {
    const { angle, gradientType, stops } = settings.backgroundGradient;
    let gradient: CanvasGradient;

    if (gradientType === "radial") {
      gradient = context.createRadialGradient(
        width / 2,
        height / 2,
        0,
        width / 2,
        height / 2,
        Math.hypot(width, height) / 2,
      );
    } else {
      const angleRad = ((angle - 90) * Math.PI) / 180;
      const halfDiagonal = Math.hypot(width, height) / 2;
      const centerX = width / 2;
      const centerY = height / 2;

      gradient = context.createLinearGradient(
        centerX - Math.cos(angleRad) * halfDiagonal,
        centerY - Math.sin(angleRad) * halfDiagonal,
        centerX + Math.cos(angleRad) * halfDiagonal,
        centerY + Math.sin(angleRad) * halfDiagonal,
      );
    }

    for (const stop of stops) {
      const alpha = Math.round(Math.min(Math.max(stop.opacity, 0), 100) * 2.55)
        .toString(16)
        .padStart(2, "0");

      gradient.addColorStop(
        Math.min(Math.max(stop.position / 100, 0), 1),
        `${stop.color}${alpha}`,
      );
    }

    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    return;
  }

  if (settings.backgroundMode === "image" && settings.backgroundImage) {
    const image = resolveImage(settings.backgroundImage);

    if (image) {
      const { height: sourceHeight, width: sourceWidth } = getTransformedSize(
        image,
        settings.backgroundImage.transform,
      );
      // Blur radius scales with the canvas short edge so the effect looks the
      // same across preview, PNG, and GIF export resolutions.
      const blurPx = settings.backgroundBlur * (Math.min(width, height) / 1080);
      // Over-scan the cover image so the soft blurred edges bleed outside the
      // visible canvas instead of fading to a transparent border.
      const overscan = blurPx > 0 ? 1 + (blurPx * 4) / Math.min(width, height) : 1;
      const coverScale =
        Math.max(width / sourceWidth, height / sourceHeight) * overscan;
      const drawWidth = sourceWidth * coverScale;
      const drawHeight = sourceHeight * coverScale;

      // A solid fill backs the blurred image so any residual edge transparency
      // never shows through.
      context.fillStyle = settings.backgroundColor;
      context.fillRect(0, 0, width, height);

      // Fast path: blur a downscaled copy on a scratch canvas, then upscale.
      const scratch = blurPx > 0 ? getBlurScratchContext(width, height) : null;

      if (blurPx > 0 && scratch) {
        const { context: scratchContext, scaleDown } = scratch;
        const scratchWidth = Math.max(1, Math.round(width * scaleDown));
        const scratchHeight = Math.max(1, Math.round(height * scaleDown));

        scratchContext.clearRect(0, 0, scratchWidth, scratchHeight);
        scratchContext.fillStyle = settings.backgroundColor;
        scratchContext.fillRect(0, 0, scratchWidth, scratchHeight);
        scratchContext.save();
        scratchContext.filter = `blur(${Math.max(0.5, blurPx * scaleDown)}px)`;
        drawTransformedImage(
          scratchContext,
          image,
          settings.backgroundImage.transform,
          (scratchWidth - drawWidth * scaleDown) / 2,
          (scratchHeight - drawHeight * scaleDown) / 2,
          drawWidth * scaleDown,
          drawHeight * scaleDown,
        );
        scratchContext.restore();

        context.save();
        context.beginPath();
        context.rect(0, 0, width, height);
        context.clip();
        context.imageSmoothingEnabled = true;
        context.drawImage(
          scratchContext.canvas,
          0,
          0,
          scratchWidth,
          scratchHeight,
          0,
          0,
          width,
          height,
        );
        context.restore();

        return;
      }

      // Fallback (no scratch 2D context, e.g. jsdom): blur on the main context.
      context.save();
      context.beginPath();
      context.rect(0, 0, width, height);
      context.clip();

      if (blurPx > 0) {
        context.filter = `blur(${blurPx}px)`;
      }

      drawTransformedImage(
        context,
        image,
        settings.backgroundImage.transform,
        (width - drawWidth) / 2,
        (height - drawHeight) / 2,
        drawWidth,
        drawHeight,
      );
      context.restore();

      return;
    }
  }

  context.fillStyle = settings.backgroundColor;
  context.fillRect(0, 0, width, height);
}

function traceRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const clampedRadius = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + clampedRadius, y);
  context.arcTo(x + width, y, x + width, y + height, clampedRadius);
  context.arcTo(x + width, y + height, x, y + height, clampedRadius);
  context.arcTo(x, y + height, x, y, clampedRadius);
  context.arcTo(x, y, x + width, y, clampedRadius);
  context.closePath();
}

function drawFrame(
  context: CanvasRenderingContext2D,
  settings: SceneSettings,
  frame: SceneFrameAsset,
  alpha: number,
  width: number,
  height: number,
  resolveImage: SceneImageResolver,
): void {
  const image = resolveImage(frame);

  if (!image || alpha <= 0) {
    return;
  }

  const { height: sourceHeight, width: sourceWidth } = getTransformedSize(
    image,
    frame.transform,
  );
  const maxWidth = (width * settings.scale) / 100;
  const maxHeight = (height * settings.scale) / 100;
  const containScale = Math.min(maxWidth / sourceWidth, maxHeight / sourceHeight);
  const drawWidth = sourceWidth * containScale;
  const drawHeight = sourceHeight * containScale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  const radiusScale = Math.min(width, height) / 1080;
  const radius = settings.cornerRadius * radiusScale;

  context.save();
  context.globalAlpha = alpha;

  if (settings.shadow) {
    context.save();
    context.shadowBlur = 48 * radiusScale;
    context.shadowColor = "rgba(0, 0, 0, 0.45)";
    context.shadowOffsetY = 18 * radiusScale;
    traceRoundedRect(context, x, y, drawWidth, drawHeight, radius);
    context.fillStyle = "rgba(0, 0, 0, 0.4)";
    context.fill();
    context.restore();
  }

  traceRoundedRect(context, x, y, drawWidth, drawHeight, radius);
  context.clip();
  drawTransformedImage(context, image, frame.transform, x, y, drawWidth, drawHeight);
  context.restore();
}

export function drawScene({
  context,
  height,
  loopProgress,
  resolveImage = (asset) => getDecodedSceneImage(asset.dataUrl),
  settings,
  width,
}: {
  context: CanvasRenderingContext2D;
  height: number;
  loopProgress: number;
  resolveImage?: SceneImageResolver;
  settings: SceneSettings;
  width: number;
}): void {
  drawBackground(context, settings, width, height, resolveImage);

  const { currentIndex, nextAlpha, nextIndex } = getSceneFrameMix(
    loopProgress,
    settings.frames.length,
    settings.transition,
  );
  const currentFrame = settings.frames[currentIndex];
  const nextFrame = settings.frames[nextIndex];

  if (!currentFrame) {
    return;
  }

  drawFrame(context, settings, currentFrame, 1, width, height, resolveImage);

  if (nextAlpha > 0 && nextFrame && nextFrame !== currentFrame) {
    drawFrame(context, settings, nextFrame, nextAlpha, width, height, resolveImage);
  }
}
