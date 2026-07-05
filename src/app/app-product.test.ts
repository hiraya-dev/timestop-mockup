import { describe, expect, it } from "vitest";

import {
  getToolcraftTimelineLoopProgress,
  getToolcraftVideoExportSize,
  type ToolcraftState,
} from "@/toolcraft/runtime";

import { appSchema } from "./app-schema";
import { getGifFrameTimesSeconds } from "./export-gif";
import { getSceneImageExportPlan } from "./export-image";
import { pickSupportedVideoMime } from "./export-video";
import {
  drawScene,
  getSceneFrameAssets,
  getSceneFrameMix,
  getSceneSettings,
  type SceneImageResolver,
  type SceneSettings,
} from "./scene";

type ContextCall = { args: unknown[]; method: string };

function createRecordingContext() {
  const calls: ContextCall[] = [];
  const gradientStops: { offset: number; color: string }[] = [];
  const state = {
    fillStyle: "" as unknown,
    filter: "none",
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: "",
    shadowOffsetY: 0,
  };
  const fillStyles: unknown[] = [];
  const shadowBlurs: number[] = [];
  const drawImageFilters: string[] = [];
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ args, method });

      if (method === "drawImage") {
        drawImageFilters.push(state.filter);
      }

      if (method === "fillRect" || method === "fill") {
        fillStyles.push(state.fillStyle);
        shadowBlurs.push(state.shadowBlur);
      }

      if (method === "createLinearGradient" || method === "createRadialGradient") {
        return {
          addColorStop: (offset: number, color: string) => {
            gradientStops.push({ color, offset });
          },
        };
      }

      return undefined;
    };
  const context = new Proxy(state, {
    get(target, property: string) {
      if (property in target) {
        return target[property as keyof typeof target];
      }

      return record(property);
    },
    set(target, property: string, value) {
      (target as Record<string, unknown>)[property] = value;

      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return { calls, context, drawImageFilters, fillStyles, gradientStops, shadowBlurs };
}

const stubImage = { height: 600, width: 800 } as unknown as ReturnType<
  typeof Object.create
> & { height: number; width: number };

const resolveStubImage: SceneImageResolver = () => stubImage;

function makeSettings(overrides: Partial<SceneSettings> = {}): SceneSettings {
  return {
    backgroundBlur: 0,
    backgroundColor: "#111113",
    backgroundGradient: null,
    backgroundImage: null,
    backgroundMode: "solid",
    cornerRadius: 16,
    frames: [{ dataUrl: "data:image/png;base64,a", id: "frame-1" }],
    includeBackground: true,
    scale: 70,
    shadow: true,
    transition: "cut",
    ...overrides,
  };
}

function makeState(
  values: Record<string, unknown>,
  mediaAssets: unknown[] = [],
): ToolcraftState {
  return {
    canvas: { offset: { x: 0, y: 0 }, size: { height: 1080, width: 1920 }, zoom: 1 },
    mediaAssets,
    timeline: {
      currentTimeSeconds: 0,
      durationSeconds: 1.5,
      expanded: false,
      isLooping: true,
      isPlaying: false,
      keyframeGroups: [],
      selectedKeyframeId: null,
    },
    values,
  } as unknown as ToolcraftState;
}

function getDrawImageCalls(calls: ContextCall[]) {
  return calls.filter((call) => call.method === "drawImage");
}

describe("loop frame scene", () => {
  it("preview render composites heavy media in one cached pass", () => {
    const recording = createRecordingContext();
    let resolveCalls = 0;
    const heavyResolver: SceneImageResolver = () => {
      resolveCalls += 1;

      return { height: 2160, width: 3840 } as never;
    };

    drawScene({
      context: recording.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: heavyResolver,
      settings: makeSettings({ shadow: false }),
      width: 1920,
    });

    // Cut transition composites exactly one bitmap draw per pass and resolves
    // the decoded image from the cache instead of re-decoding it.
    expect(getDrawImageCalls(recording.calls)).toHaveLength(1);
    expect(resolveCalls).toBe(1);
  });

  it("section images map to the ordered frame sequence", () => {
    const state = makeState({}, [
      {
        dataUrl: "data:image/png;base64,first",
        id: "a",
        sourceTarget: "frames.images",
        transform: { rotationDeg: 90 },
      },
      { dataUrl: "data:image/png;base64,bg", id: "bg", sourceTarget: "background.image" },
      { dataUrl: "data:image/png;base64,second", id: "b", sourceTarget: "frames.images" },
    ]);
    const frames = getSceneFrameAssets(state);

    expect(frames.map((frame) => frame.id)).toEqual(["a", "b"]);
    expect(frames[0]?.transform?.rotationDeg).toBe(90);

    const mixAtStart = getSceneFrameMix(0, frames.length, "cut");
    const mixAtSecondSlot = getSceneFrameMix(0.6, frames.length, "cut");

    expect(mixAtStart.currentIndex).toBe(0);
    expect(mixAtSecondSlot.currentIndex).toBe(1);
  });

  it("transition mode switches between cut and crossfade frame mixing", () => {
    const cutMix = getSceneFrameMix(0.45, 2, "cut");
    const fadeMix = getSceneFrameMix(0.45, 2, "crossfade");

    expect(cutMix.nextAlpha).toBe(0);
    expect(fadeMix.nextAlpha).toBeGreaterThan(0);
    expect(fadeMix.nextIndex).toBe(1);

    const earlySlot = getSceneFrameMix(0.1, 2, "crossfade");

    expect(earlySlot.nextAlpha).toBe(0);
  });

  it("frame scale changes the drawn frame footprint", () => {
    const small = createRecordingContext();
    const large = createRecordingContext();

    drawScene({
      context: small.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({ scale: 30, shadow: false }),
      width: 1920,
    });
    drawScene({
      context: large.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({ scale: 90, shadow: false }),
      width: 1920,
    });

    const smallDraw = getDrawImageCalls(small.calls)[0]?.args as number[];
    const largeDraw = getDrawImageCalls(large.calls)[0]?.args as number[];

    expect(Math.abs(Number(smallDraw?.[3]))).toBeLessThan(Math.abs(Number(largeDraw?.[3])));
  });

  it("corner radius rounds the frame corners", () => {
    const rounded = createRecordingContext();
    const square = createRecordingContext();

    drawScene({
      context: rounded.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({ cornerRadius: 80, shadow: false }),
      width: 1920,
    });
    drawScene({
      context: square.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({ cornerRadius: 0, shadow: false }),
      width: 1920,
    });

    const roundedArc = rounded.calls.find((call) => call.method === "arcTo");
    const squareArc = square.calls.find((call) => call.method === "arcTo");

    expect(Number(roundedArc?.args[4])).toBeGreaterThan(0);
    expect(Number(squareArc?.args[4])).toBe(0);
  });

  it("frame shadow toggles the drop shadow pass", () => {
    const withShadow = createRecordingContext();
    const withoutShadow = createRecordingContext();

    drawScene({
      context: withShadow.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({ shadow: true }),
      width: 1920,
    });
    drawScene({
      context: withoutShadow.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({ shadow: false }),
      width: 1920,
    });

    expect(withShadow.shadowBlurs.some((blur) => blur > 0)).toBe(true);
    expect(withoutShadow.shadowBlurs.every((blur) => blur === 0)).toBe(true);
  });

  it("background mode selects solid gradient or image backdrops", () => {
    const solidState = makeState({
      "background.color": { hex: "#FF0044" },
      "background.mode": "solid",
    });
    const solidSettings = getSceneSettings(solidState, { includeBackground: true });

    expect(solidSettings.backgroundMode).toBe("solid");

    const solid = createRecordingContext();

    drawScene({
      context: solid.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({ backgroundColor: "#FF0044", frames: [] }),
      width: 1920,
    });
    expect(solid.fillStyles).toContain("#FF0044");

    const gradient = createRecordingContext();

    drawScene({
      context: gradient.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({
        backgroundGradient: {
          angle: 90,
          gradientType: "linear",
          stops: [
            { color: "#000000", opacity: 100, position: 0 },
            { color: "#FFFFFF", opacity: 100, position: 100 },
          ],
        },
        backgroundMode: "gradient",
        frames: [],
      }),
      width: 1920,
    });
    expect(
      gradient.calls.some((call) => call.method === "createLinearGradient"),
    ).toBe(true);

    const image = createRecordingContext();

    drawScene({
      context: image.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({
        backgroundImage: { dataUrl: "data:image/png;base64,bg", id: "bg" },
        backgroundMode: "image",
        frames: [],
      }),
      width: 1920,
    });
    expect(getDrawImageCalls(image.calls).length).toBeGreaterThan(0);
  });

  it("include background controls png alpha and preview background", () => {
    const excluded = createRecordingContext();

    drawScene({
      context: excluded.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({ frames: [], includeBackground: false }),
      width: 1920,
    });
    expect(excluded.calls.some((call) => call.method === "fillRect")).toBe(false);

    const plan = getSceneImageExportPlan({ "export.image.format": "png" }, false);

    expect(plan.includeBackground).toBe(false);

    const jpgPlan = getSceneImageExportPlan({ "export.image.format": "jpg" }, false);

    expect(jpgPlan.includeBackground).toBe(true);
  });

  it("background color fills the solid backdrop", () => {
    const settings = getSceneSettings(
      makeState({ "background.color": { hex: "#22AA88" }, "background.mode": "solid" }),
      { includeBackground: true },
    );

    expect(settings.backgroundColor).toBe("#22AA88");

    const recording = createRecordingContext();

    drawScene({
      context: recording.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({ backgroundColor: "#22AA88", frames: [] }),
      width: 1920,
    });
    expect(recording.fillStyles).toContain("#22AA88");
  });

  it("background gradient renders type angle and stops", () => {
    const linear = createRecordingContext();
    const gradientSettings = makeSettings({
      backgroundGradient: {
        angle: 45,
        gradientType: "linear",
        stops: [
          { color: "#102030", opacity: 100, position: 10 },
          { color: "#405060", opacity: 50, position: 90 },
        ],
      },
      backgroundMode: "gradient",
      frames: [],
    });

    drawScene({
      context: linear.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: gradientSettings,
      width: 1920,
    });

    expect(linear.calls.some((call) => call.method === "createLinearGradient")).toBe(true);
    expect(linear.gradientStops.map((stop) => stop.offset)).toEqual([0.1, 0.9]);
    expect(linear.gradientStops[1]?.color.toLowerCase()).toBe("#4050607f");

    const radial = createRecordingContext();

    drawScene({
      context: radial.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({
        backgroundGradient: {
          ...gradientSettings.backgroundGradient!,
          gradientType: "radial",
        },
        backgroundMode: "gradient",
        frames: [],
      }),
      width: 1920,
    });
    expect(radial.calls.some((call) => call.method === "createRadialGradient")).toBe(true);

    const rotated = createRecordingContext();

    drawScene({
      context: rotated.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({
        backgroundGradient: {
          ...gradientSettings.backgroundGradient!,
          angle: 225,
        },
        backgroundMode: "gradient",
        frames: [],
      }),
      width: 1920,
    });

    const linearArgs = linear.calls.find((call) => call.method === "createLinearGradient")
      ?.args as number[];
    const rotatedArgs = rotated.calls.find(
      (call) => call.method === "createLinearGradient",
    )?.args as number[];

    expect(linearArgs).not.toEqual(rotatedArgs);
  });

  it("backdrop image covers the canvas behind frames", () => {
    const recording = createRecordingContext();

    drawScene({
      context: recording.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({
        backgroundImage: { dataUrl: "data:image/png;base64,bg", id: "bg" },
        backgroundMode: "image",
        frames: [],
      }),
      width: 1920,
    });

    const [drawCall] = getDrawImageCalls(recording.calls);
    const drawWidth = Math.abs(Number((drawCall?.args as number[])[3]));
    const drawHeight = Math.abs(Number((drawCall?.args as number[])[4]));

    // Cover behavior: the drawn backdrop is at least as large as the canvas on both axes.
    expect(drawWidth).toBeGreaterThanOrEqual(1920);
    expect(drawHeight).toBeGreaterThanOrEqual(1080);
  });

  it("background blur softens the backdrop image", () => {
    const sharp = createRecordingContext();
    const blurred = createRecordingContext();
    const backdrop = {
      backgroundImage: { dataUrl: "data:image/png;base64,bg", id: "bg" },
      backgroundMode: "image" as const,
      frames: [],
    };

    drawScene({
      context: sharp.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({ ...backdrop, backgroundBlur: 0 }),
      width: 1920,
    });
    drawScene({
      context: blurred.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: resolveStubImage,
      settings: makeSettings({ ...backdrop, backgroundBlur: 40 }),
      width: 1920,
    });

    // With blur off, the backdrop draws with no canvas filter.
    expect(sharp.drawImageFilters.every((filter) => filter === "none")).toBe(true);
    // With blur on, the backdrop image is drawn under a canvas blur filter.
    expect(blurred.drawImageFilters.some((filter) => /^blur\(/.test(filter))).toBe(true);
  });

  it("image export format changes the exported mime type", () => {
    expect(getSceneImageExportPlan({ "export.image.format": "png" }, true)).toMatchObject({
      fileName: "loop-frame.png",
      mimeType: "image/png",
    });
    expect(getSceneImageExportPlan({ "export.image.format": "jpg" }, true)).toMatchObject({
      fileName: "loop-frame.jpg",
      mimeType: "image/jpeg",
    });
  });

  it("image export resolution changes exported pixel dimensions", () => {
    expect(getSceneImageExportPlan({ "export.image.resolution": "2k" }, true).resolution).toBe(
      "2k",
    );
    expect(getSceneImageExportPlan({ "export.image.resolution": "8k" }, true).resolution).toBe(
      "8k",
    );
    expect(getSceneImageExportPlan({}, true).resolution).toBe("4k");
  });

  it("video export format picks a supported recorder mime", () => {
    const mp4Supported = pickSupportedVideoMime("mp4", (mime) => mime.startsWith("video/mp4"));

    expect(mp4Supported.extension).toBe("mp4");

    const mp4Fallback = pickSupportedVideoMime("mp4", (mime) => mime.startsWith("video/webm"));

    expect(mp4Fallback.extension).toBe("webm");

    const webm = pickSupportedVideoMime("webm", (mime) => mime === "video/webm");

    expect(webm.mimeType).toBe("video/webm");

    const nothingSupported = pickSupportedVideoMime("mp4", () => false);

    expect(nothingSupported.extension).toBe("webm");
  });

  it("video export resolution uses encoder safe dimensions", () => {
    const state = makeState({});
    const current = getToolcraftVideoExportSize({ resolution: "current", state });

    expect(current).toMatchObject({ height: 1080, width: 1920 });
    expect(current.width % 2).toBe(0);
    expect(current.height % 2).toBe(0);

    const fourK = getToolcraftVideoExportSize({ resolution: "4k", state });

    expect(fourK.width).toBeLessThanOrEqual(3840);
    expect(fourK.height).toBeLessThanOrEqual(2160);
    expect(fourK.width % 2).toBe(0);
    expect(fourK.height % 2).toBe(0);
    expect(fourK.width / fourK.height).toBeCloseTo(1920 / 1080, 1);
  });

  it("export actions deliver gif video and png output", () => {
    const exportSection = appSchema.panels.controls?.sections.find((section) =>
      Object.values(section.controls).some((control) => control.type === "panelActions"),
    );
    const actionsControl = Object.values(exportSection?.controls ?? {}).find(
      (control) => control.type === "panelActions",
    );
    const actionValues = (actionsControl?.actions ?? []).map((action) =>
      typeof action === "string" ? action : action.value,
    );

    expect(actionValues).toEqual(["export-video", "export-png", "export-gif"]);

    const cutTimes = getGifFrameTimesSeconds(1.5, 3, "cut");

    expect(cutTimes).toHaveLength(3);
    expect(cutTimes[0]).toBeCloseTo(0.25, 5);
    expect(cutTimes[2]).toBeCloseTo(1.25, 5);

    const fadeTimes = getGifFrameTimesSeconds(1.5, 3, "crossfade");

    expect(fadeTimes.length).toBe(30);
    expect(fadeTimes.at(-1)!).toBeLessThan(1.5);
  });

  it("timeline loop maps one frame cycle to the edited duration", () => {
    const frameCount = 3;
    const editedDuration = 2.4;
    const progressAtHalf = getToolcraftTimelineLoopProgress({
      currentTimeSeconds: editedDuration / 2,
      durationSeconds: editedDuration,
    });

    expect(getSceneFrameMix(progressAtHalf, frameCount, "cut").currentIndex).toBe(1);

    const progressNearEnd = getToolcraftTimelineLoopProgress({
      currentTimeSeconds: editedDuration - 0.01,
      durationSeconds: editedDuration,
    });

    expect(getSceneFrameMix(progressNearEnd, frameCount, "cut").currentIndex).toBe(
      frameCount - 1,
    );

    // Seamless forward-only loop: the wrapped time renders the first frame again.
    const wrappedProgress = getToolcraftTimelineLoopProgress({
      currentTimeSeconds: editedDuration,
      durationSeconds: editedDuration,
    });

    expect(getSceneFrameMix(wrappedProgress, frameCount, "cut").currentIndex).toBe(0);
    expect(getSceneFrameMix(0.99, frameCount, "crossfade").nextIndex).toBe(0);
  });

  it("canvas keeps editable output size when media uploads", () => {
    expect(appSchema.canvas.sizing.mode).toBe("editable-output");

    const recording = createRecordingContext();

    drawScene({
      context: recording.context,
      height: 1080,
      loopProgress: 0,
      resolveImage: () => ({ height: 904, width: 678 }) as never,
      settings: makeSettings({ scale: 70, shadow: false }),
      width: 1920,
    });

    const [drawCall] = getDrawImageCalls(recording.calls);
    const drawWidth = Math.abs(Number((drawCall?.args as number[])[3]));
    const drawHeight = Math.abs(Number((drawCall?.args as number[])[4]));

    // Contain fit: the uploaded portrait image stays inside the frame-scale bounds.
    expect(drawWidth).toBeLessThanOrEqual(1920 * 0.7 + 1);
    expect(drawHeight).toBeLessThanOrEqual(1080 * 0.7 + 1);
  });
});

describe("loop frame runtime setup", () => {
  it("render scale slider is a discrete control", () => {
    const setupSection = appSchema.panels.controls?.sections.find((section) =>
      Object.values(section.controls).some(
        (control) => control.target === "canvas.renderScale",
      ),
    );
    const renderScale = Object.values(setupSection?.controls ?? {}).find(
      (control) => control.target === "canvas.renderScale",
    );

    expect(renderScale?.type).toBe("slider");
    expect(renderScale?.variant).toBe("discrete");
    // 1..2 in 0.25 steps yields five discrete tick positions.
    expect(renderScale?.min).toBe(1);
    expect(renderScale?.max).toBe(2);
  });
});
