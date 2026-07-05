import {
  createToolcraftPngExportCanvas,
  getToolcraftTimelineLoopProgress,
  shouldIncludeToolcraftPreviewBackground,
  type ToolcraftState,
} from "@/toolcraft/runtime";

import { drawScene, getSceneSettings, loadSceneImages } from "./scene";

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type SceneImageExportPlan = {
  fileName: string;
  format: "jpg" | "png";
  includeBackground: boolean;
  mimeType: "image/jpeg" | "image/png";
  resolution: string;
};

export function getSceneImageExportPlan(
  values: Record<string, unknown>,
  includeBackground: boolean,
): SceneImageExportPlan {
  const format = values["export.image.format"] === "jpg" ? "jpg" : "png";

  return {
    fileName: `loop-frame.${format}`,
    format,
    // JPEG has no alpha channel, so JPG export always keeps the background.
    includeBackground: format === "jpg" ? true : includeBackground,
    mimeType: format === "jpg" ? "image/jpeg" : "image/png",
    resolution: String(values["export.image.resolution"] ?? "4k"),
  };
}

export async function exportSceneImage({
  reportProgress,
  state,
}: {
  reportProgress: (progress: number) => void;
  state: ToolcraftState;
}): Promise<void> {
  const includeBackground = shouldIncludeToolcraftPreviewBackground({ state });
  const settings = getSceneSettings(state, { includeBackground });
  const plan = getSceneImageExportPlan(state.values, includeBackground);
  const { fileName, format, mimeType } = plan;
  const imageResolution = String(state.values["export.image.resolution"] ?? plan.resolution);
  const loopProgress = getToolcraftTimelineLoopProgress(state.timeline);

  reportProgress(0.1);
  await loadSceneImages(settings);
  reportProgress(0.4);

  const exportIncludeBackground = plan.includeBackground;
  const exportSettings = { ...settings, includeBackground: exportIncludeBackground };
  const canvas = createToolcraftPngExportCanvas({
    background: settings.backgroundColor,
    includeBackground: exportIncludeBackground,
    render: ({ context, cssHeight, cssWidth }) => {
      drawScene({
        context,
        height: cssHeight,
        loopProgress,
        settings: exportSettings,
        width: cssWidth,
      });
    },
    resolution: imageResolution,
    state,
  });

  reportProgress(0.7);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) {
          resolve(result);
        } else {
          reject(new Error("Image export failed to encode."));
        }
      },
      mimeType,
      format === "jpg" ? 0.92 : undefined,
    );
  });

  reportProgress(0.95);
  downloadBlob(blob, fileName);
  reportProgress(1);
}
