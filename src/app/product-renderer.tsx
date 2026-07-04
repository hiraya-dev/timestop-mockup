import * as React from "react";

import {
  getToolcraftTimelineLoopProgress,
  shouldIncludeToolcraftPreviewBackground,
} from "@/toolcraft/runtime";
import { useToolcraft } from "@/toolcraft/runtime/react";

import { drawScene, getSceneSettings, loadSceneImages, type SceneSettings } from "./scene";

function getRenderScale(values: Record<string, unknown>): number {
  const value = Number(values["canvas.renderScale"]);

  return Number.isFinite(value) && value >= 1 ? Math.min(value, 2) : 2;
}

function useCanvasViewportInteraction(): React.RefObject<boolean> {
  const isInteractingRef = React.useRef(false);

  React.useEffect(() => {
    const isViewportEvent = (event: Event): boolean =>
      event.target instanceof Element &&
      Boolean(event.target.closest('[role="application"]'));
    const startInteraction = (event: Event) => {
      if (isViewportEvent(event)) {
        isInteractingRef.current = true;
      }
    };
    const endInteraction = () => {
      isInteractingRef.current = false;
    };
    let wheelIdleTimer: number | undefined;
    const onWheel = (event: Event) => {
      if (!isViewportEvent(event)) {
        return;
      }

      isInteractingRef.current = true;
      window.clearTimeout(wheelIdleTimer);
      wheelIdleTimer = window.setTimeout(endInteraction, 160);
    };

    document.addEventListener("pointerdown", startInteraction, { capture: true });
    document.addEventListener("pointerup", endInteraction, { capture: true });
    document.addEventListener("pointercancel", endInteraction, { capture: true });
    document.addEventListener("wheel", onWheel, { capture: true, passive: true });

    return () => {
      document.removeEventListener("pointerdown", startInteraction, { capture: true });
      document.removeEventListener("pointerup", endInteraction, { capture: true });
      document.removeEventListener("pointercancel", endInteraction, { capture: true });
      document.removeEventListener("wheel", onWheel, { capture: true });
      window.clearTimeout(wheelIdleTimer);
    };
  }, []);

  return isInteractingRef;
}

export function ProductRenderer(): React.JSX.Element {
  const { state } = useToolcraft();
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const isInteractingRef = useCanvasViewportInteraction();
  const pendingSceneRef = React.useRef<{
    loopProgress: number;
    settings: SceneSettings;
  } | null>(null);
  const drawFrameRef = React.useRef<number | null>(null);
  const [, forceRender] = React.useReducer((tick: number) => tick + 1, 0);

  const includeBackground = shouldIncludeToolcraftPreviewBackground({ state });
  const settings = getSceneSettings(state, { includeBackground });
  const loopProgress = getToolcraftTimelineLoopProgress(state.timeline);
  const renderScale = getRenderScale(state.values);
  const { height, width } = state.canvas.size;
  const backingWidth = Math.max(1, Math.round(width * renderScale));
  const backingHeight = Math.max(1, Math.round(height * renderScale));
  const mediaSignature = [
    ...settings.frames.map((frame) => frame.dataUrl.length + (frame.id ?? "")),
    settings.backgroundImage
      ? settings.backgroundImage.dataUrl.length + settings.backgroundImage.id
      : "",
  ].join("|");

  React.useEffect(() => {
    let cancelled = false;

    loadSceneImages(settings)
      .then(() => {
        if (!cancelled) {
          forceRender();
        }
      })
      .catch(() => {
        // Ignore decode failures; frames without decoded images are skipped.
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaSignature]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    const paint = (scene: { loopProgress: number; settings: SceneSettings }) => {
      context.save();
      context.clearRect(0, 0, backingWidth, backingHeight);
      context.scale(renderScale, renderScale);
      drawScene({
        context,
        height,
        loopProgress: scene.loopProgress,
        settings: scene.settings,
        width,
      });
      context.restore();
    };
    const scene = { loopProgress, settings };

    if (isInteractingRef.current && state.timeline.isPlaying) {
      pendingSceneRef.current = scene;

      if (drawFrameRef.current === null) {
        const drainPending = () => {
          drawFrameRef.current = null;

          if (!pendingSceneRef.current) {
            return;
          }

          if (isInteractingRef.current) {
            drawFrameRef.current = window.requestAnimationFrame(drainPending);

            return;
          }

          paint(pendingSceneRef.current);
          pendingSceneRef.current = null;
        };

        drawFrameRef.current = window.requestAnimationFrame(drainPending);
      }

      return;
    }

    pendingSceneRef.current = null;
    paint(scene);
  });

  React.useEffect(
    () => () => {
      if (drawFrameRef.current !== null) {
        window.cancelAnimationFrame(drawFrameRef.current);
      }
    },
    [],
  );

  return (
    <canvas
      data-toolcraft-product-output=""
      height={backingHeight}
      ref={canvasRef}
      style={{ display: "block", height: "100%", width: "100%" }}
      width={backingWidth}
    />
  );
}
