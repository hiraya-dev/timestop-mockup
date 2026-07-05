import type { SceneSettings } from "./scene";
import { drawScene } from "./scene";

export function paintSceneExportFrame({
  backgroundColor,
  context,
  cssHeight,
  cssWidth,
  exportHeight,
  exportWidth,
  includeBackgroundFill,
  loopProgress,
  pixelRatio,
  settings,
}: {
  backgroundColor: string;
  context: CanvasRenderingContext2D;
  cssHeight: number;
  cssWidth: number;
  exportHeight: number;
  exportWidth: number;
  includeBackgroundFill: boolean;
  loopProgress: number;
  pixelRatio: number;
  settings: SceneSettings;
}): void {
  context.save();
  context.clearRect(0, 0, exportWidth, exportHeight);

  if (includeBackgroundFill) {
    context.fillStyle = backgroundColor;
    context.fillRect(0, 0, exportWidth, exportHeight);
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.scale(pixelRatio, pixelRatio);
  drawScene({
    context,
    height: cssHeight,
    loopProgress,
    settings,
    width: cssWidth,
  });
  context.restore();
}

export function shouldDitherGifBackground(settings: SceneSettings): boolean {
  return (
    settings.backgroundMode === "gradient" ||
    (settings.backgroundMode === "image" && settings.backgroundBlur > 0)
  );
}
