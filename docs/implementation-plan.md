# Implementation Plan — Layered GIF Creator

Verification tier: Tier 4
Reason: fresh generated app completion — new schema, custom renderer, timeline,
media, export (PNG/video/GIF), dependency change (gifenc), full acceptance and
performance matrices.
Run: `pnpm verify:final`, agent-browser performance checkpoint, `pnpm dev`.
Skip: none (first working product delivery).

## Steps

1. `pnpm add gifenc` (GIF encoder dependency).
2. `src/app/scene.ts` — pure scene model + `drawScene(ctx, sceneInput)` shared
   by preview and all exporters; image cache module keyed by dataUrl;
   frame-sequence math (`getFrameCycle(progress, frameCount, transition)`).
3. `src/app/product-renderer.tsx` — Canvas 2D `canvasContent` renderer:
   reads runtime state + timeline loop progress, renderScale-aware backing,
   `data-toolcraft-product-output`, suspends animation during viewport
   interaction.
4. `src/app/export-image.ts`, `src/app/export-video.ts`,
   `src/app/export-gif.ts` — exporters over the shared draw function.
5. `src/app/app-schema.ts` — full product schema per spec (sections, timeline
   playback 1.5s, renderScale, editable-output canvas, panelActions).
6. `src/routes/index.tsx` — `ToolcraftApp` with `canvasContent`,
   `renderDefaultCanvasMedia={false}`, `onPanelAction` for the three exports.
7. `src/app/app-acceptance.ts` (top constants only) — product readiness,
   transfer mode with videoReferenceStudy (6 storyboard frames, 5 transitions,
   decomposition, acceptance mapping), animationIntent timeline-playback 1.5s,
   `starterControlSectionInventory`, `appAcceptance` rows for every control,
   runtime behavior, media lifecycle, timeline, exports.
8. `src/app/app-performance.ts` — rendererTechnique matrix, rendererPipeline
   (decode/composite passes with cache keys + interaction invalidation),
   scenarios: preview-render, control-drag (frame.scale w/ media workload),
   control-change (background.mode), media-import, export-copy,
   timeline-playback, animation-viewport-drag, viewport-zoom-stress,
   viewport-stability, render-scale drag.
9. e2e: replace starter `app-controls.spec.ts` with product control tests;
   add `e2e/app-product.spec.ts` browser tests matching every
   `browserTestName`; extend `e2e/app-performance.spec.ts` with `browser perf:`
   scenario tests driven by `appPerformance` fixtures.
10. `docs/toolcraft/agent-worklog.md` — product mode, decision trail, evidence.
11. Iterate `pnpm verify:quick` until green, then `pnpm verify:final`,
    agent-browser performance checkpoint, `pnpm dev`.
