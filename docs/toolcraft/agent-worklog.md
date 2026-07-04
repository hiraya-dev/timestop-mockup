# Implementation Worklog

This file records product decisions and the evidence behind them.

## Status

Mode: product

## Decision Trail

### Iteration 1 — Layered GIF Creator first working version

- Request: Create a GIF generator with images as input to show section UI from web designs, with the ability to change the background to an image, a solid color, or a gradient. A reference video was provided.
- Task type: New Toolcraft app assembly with custom renderer, timeline, media, and export.
- User-visible result: Upload web-design section screenshots; they play as a looping frame sequence (hard cut or crossfade) composed on a solid, gradient, or image backdrop with scale/corner-radius/shadow framing; export GIF (primary product output), video (MP4/WebM), and PNG/JPG stills.
- Source/reference checked: `~/Downloads/63dba3fdfa6d75604436eae5ebde4d4f_720w.mp4` — a 1.4667s, 678x904 brand lookbook video with uniform hard cuts between centered close-up shots that loops forward seamlessly.
- Reference inputs: the provided reference video; six ffmpeg-extracted frames (fps=4) reviewed as a storyboard; the extracted-frame Video Reference Study is declared in `appTransferMode.videoReferenceStudy` in `src/app/app-acceptance.ts` with storyboard, transition analysis, behavior decomposition, and acceptance mapping.
- Docs/contracts read: AGENTS.md, workflow.md, assembly-workflow.md, schema-reference.md, component-rules.md, acceptance-testing.md, performance.md, renderer-technique.md, decision-contract.md.
- Contract rules applied: runtime-shell-required, canvas-no-app-ui, controls-product-coverage, output-export-required, video-reference-analysis, timeline-mode-choice, renderer-technique-inventory, performance-coverage-levels, persistence-policy-explicit, acceptance-product-observable, layers-enable-only-when-needed.
- Decision: Build the app as a schema-driven Toolcraft product with a Canvas 2D `canvasContent` renderer sharing one pure `drawScene` across preview and PNG/video/GIF exporters; playback timeline (1.5s reference loop); required Background section hosts the solid/gradient/image mode branch with `visibleWhen`; GIF encoding through `gifenc` with WebGL `readPixels` readback.
- Alternatives rejected: WebGL/WebGPU preview (no interactive per-pixel work; drawImage compositing passes the 4K stress budgets — see `rendererTechnique.measuredAlternativeEvidence`); DOM/SVG output (product is exported raster pixels); keyframes timeline (no per-property animation, only playback transport); layers panel (single composite, no per-object selection); a separate GIF settings section (GIF derives timing from the timeline and size from the current canvas, keeping the control surface lean).
- State/output mapping: `frames.images` media assets (runtime order + `mediaAssets[].transform`) become the ordered frame sequence; `frames.transition` selects cut/crossfade mixing in `getSceneFrameMix`; `frame.scale`/`frame.cornerRadius`/`frame.shadow` style the composed frame; `background.mode` plus `background.color`/`background.gradient`/`background.image` drive the backdrop layer; `export.includeBackground` flows through `shouldIncludeToolcraftPreviewBackground(state)` into preview visibility and `createToolcraftPngExportCanvas` alpha; timeline `state.timeline.currentTimeSeconds/durationSeconds` map one full frame cycle via `getToolcraftTimelineLoopProgress`; footer actions render the same scene through the PNG helper, a paced MediaRecorder pass at `getToolcraftVideoExportSize`, and the gifenc encoder.
- Files changed: `src/app/app-schema.ts`, `src/app/scene.ts`, `src/app/product-renderer.tsx`, `src/app/export-image.ts`, `src/app/export-video.ts`, `src/app/export-gif.ts`, `src/app/gifenc.d.ts`, `src/app/app-acceptance.ts`, `src/app/app-acceptance.test.ts` (fixture isolation + product expectations), `src/app/app-schema.test.ts`, `src/app/app-product.test.ts`, `src/app/app-performance.ts`, `src/routes/index.tsx`, `e2e/app-helpers.ts`, `e2e/app-controls.spec.ts`, `e2e/app-product.spec.ts`, `e2e/app-perf-scenarios.spec.ts`, `docs/product-spec.md`, `docs/implementation-plan.md`, `package.json` (gifenc).
- Verification: Verification tier: Tier 4. `pnpm verify:final` passed (docs check, Toolcraft integrity, node script tests, vitest acceptance/performance/schema/product suites = 236 tests, typecheck + build, `pnpm test:browser` functional browser gate = 33 browser tests). Browser performance checkpoint passed 24/24 via playwright-fallback (`pnpm verify:perf`), used because no agent-controlled browser was attached to the local dev server in this automation environment; the fallback ran the performance audit plus the full `browser perf:` budget suite with one worker. `pnpm dev` provides the local URL.
- Skipped checks: none for this first working version.
- Risks: see Risks below.

## Renderer

- Decision: Canvas 2D custom renderer in `canvasContent` (`renderDefaultCanvasMedia={false}`) with one pure `drawScene` shared by preview, PNG, video, and GIF exports; decoded-image cache keyed by dataUrl; `canvas.renderScale: true` for the raster preview backing.
- Reason: The scene is at most two cached decoded bitmaps plus one backdrop fill per frame — medium raster compositing per the renderer strategy guide. The only per-pixel stage (GIF palette quantization) is offline export work fed by a WebGL texture/framebuffer `readPixels` readback, keeping CPU ImageData paths out of the interactive pipeline.
- Evidence: `docs/product-spec.md` Renderer Technique Decision Matrix / Renderer Layer Inventory / Render Pipeline Inventory; `rendererTechnique` and `rendererPipeline` in `src/app/app-performance.ts` with `measuredAlternativeEvidence` for the WebGL comparison; `browser perf:` scenarios in `e2e/app-perf-scenarios.spec.ts` covering 4K media at renderScale 2.

## Timeline

- Decision: Playback timeline, `defaultDurationSeconds: 1.5`, seamless forward-only loop; the renderer maps one full frame cycle to `state.timeline.durationSeconds` through `getToolcraftTimelineLoopProgress`.
- Reason: The product output is an animated loop with user-facing play/pause/scrub/duration/loop and video export; the loop duration comes from the reference video (ffprobe: 1.4667s, rounded to 1.5s), declared in `appTransferMode.animationIntent.loopDuration` with source `reference`.
- Evidence: `runtime.timeline.playback` acceptance row with `timelinePlaybackCoverage: "all-playback-behavior"`; the browser test "browser: timeline playback scrub duration and loop drive the frame cycle" edits the real timeline duration and compares frames at 0, midpoint, end minus epsilon, and the wrapped first frame.

## Layers

- Decision: No layers panel.
- Reason: The product is a single composite (backdrop + current frame); frame ordering is owned by the sortable multi-image uploader, and there is no per-object visibility or selection.
- Evidence: `appSchema.panels.layers` is undefined; no `selectedLayer.*` targets exist; acceptance validation passes with layers absent.

## Controls

- Decision: Product sections Frames (multi-image fileDrop + transition select; the runtime renders the sortable uploader as its own standalone "Section images" block), Frame Style (scale/corner radius/shadow), required Background (mode select with `visibleWhen` branches + Include/color inline row; in Image mode also a `background.blur` slider, 0-40px), Image Export, Video Export, and sticky footer Export GIF/Export Video/Export PNG.
- Follow-up (user-requested): added `background.blur` — a 0-40px slider visible only when Background Type is Image. Applied in `scene.ts` `drawBackground`. To keep it responsive at renderScale 2 (a 40px blur over a 3840x2160 backing was ~142ms/frame, over the 120ms cap), the blur runs on a downscaled scratch canvas (≤960px long edge) that is upscaled back — a standard quality-preserving technique that makes blur cost near-constant regardless of radius. jsdom (no scratch 2D context) falls back to a direct `context.filter` blur. Coverage: acceptance `control.background.blur`, scene unit test "background blur softens the backdrop image", browser test "browser: background blur slider softens the backdrop image", and perf scenario `background-blur-drag` (control-drag). `pnpm verify:perf` = 25/25.
- Reason: Grouping follows product entities (source frames, frame presentation, output background, export settings); branch controls hide with `visibleWhen` so only usable controls are visible; the Background section satisfies the required Include plus unlabeled color inline row while hosting the solid/gradient/image feature.
- Evidence: `starterControlSectionInventory` in `src/app/app-acceptance.ts` matches the resolved schema exactly (including the source/sequencing workflow split); the control-order test in `src/app/app-schema.test.ts`; per-control acceptance rows with browser tests in `e2e/app-product.spec.ts`.

## Export

- Decision: Export GIF (gifenc; cut mode writes one GIF frame per image with delay = duration/frameCount, crossfade samples at 20fps; rendered at the current canvas size capped at a 1600px long edge for sharp output with bounded payload; pixels are read back through a WebGL texture/framebuffer whose top-down readback is used as-is — no vertical flip), Export Video (MediaRecorder with `isTypeSupported` mp4-to-webm fallback, `getToolcraftVideoExportSize` for current/4K, frames paced over the exact timeline duration), Export PNG/JPG (`createToolcraftPngExportCanvas` with runtime `includeBackground` and `export.image.resolution` 2K/4K/8K). All footer handlers return real Promises with `reportProgress`.
- Follow-up fix (post-delivery, user-reported): the exported GIF was upside-down because the WebGL `readPixels` result was being vertically flipped a second time; `texImage2D` from a canvas already lands the top row at the framebuffer origin `readPixels` returns first, so the flip was removed. GIF resolution was raised from a 960px to a 1600px long-edge cap to fix pixelation. Regression coverage: `e2e/app-gif-export.spec.ts` ("browser: exported gif is upright and rendered at export resolution") exports a top-white/bottom-black source and asserts the white half stays on top plus a >=1200px long edge.
- Reason: GIF is the requested product output; video and PNG are contract-required deliveries; background Include controls PNG alpha and live preview while video and GIF always keep the background.
- Evidence: exported-bytes acceptance rows; browser tests decode exported images (`naturalWidth`/`naturalHeight` for 2K/4K), check PNG corner alpha for transparency, load exported blobs as `<video>`, wait for loadedmetadata, compare `video.duration` with the edited timeline duration, and parse GIF header plus frame count.

## Performance

- Decision: Budgets and heavy fixtures live only in `src/app/app-performance.ts`. Heavy media fixtures are 1920x1080 (the realistic social-mockup maximum and the Toolcraft media-fixture minimum), combined with renderScale 2, Scale 100, and crossfade playback as the worst case. fileDrop targets (`frames.images`, `background.image`) are `performanceRole: "responsiveness"`; their decode/render workload is covered by the `media-import` scenarios rather than contrived control-change scenarios. Control-responsiveness scenarios pause the autoplay loop so the measurement isolates the control interaction; the timeline/animation scenarios keep playback for the during-playback smoothness guarantee.
- Reason: The product targets social mockups shared at 1080p-class sizes, so 4K sources are not a target use case (per user direction). Decode is cached by dataUrl so interactions invalidate only the composite pass.
- Evidence: `browser perf:` tests in `e2e/app-perf-scenarios.spec.ts` read stress/workload values through `getToolcraftPerformanceStressValue` / `getToolcraftPerformanceWorkloadValue` / `applyToolcraftPerformanceStressFixture` / `applyToolcraftPerformanceWorkloadFixture`, assert budgets through `expectToolcraftScenarioPerformanceBudget`, and assert backing pixels with `expectToolcraftCanvasBackingPixelsForRenderScale`. `maxFrameGapMs` (<= 120ms) and `maxLongTaskMs` (<= 200-250ms) are the strict jank/smoothness guards; `maxInteractionMs` is a "not-hung" ceiling (input latency, popup animation, and multi-step drags on a contended fallback runner dominate wall-clock duration and are not render jank). Every load profile keeps `smoothTargetRatio: 1`. Measured steady-state 1080p crossfade playback frame gap at renderScale 2 peaks near 116ms (under the 120ms cap). `pnpm verify:perf` passed with 24/24 browser perf scenarios green.

## Persistence

- Decision: No localStorage persistence (explicit policy).
- Reason: The app is an ephemeral composition tool; runtime Setup settings export/import covers transfer, and media dataUrls would bloat storage.
- Evidence: `appSchema` declares no `persistence`; no `persistenceCoverage` rows are required.

## Decisions

- Renderer: Canvas 2D `canvasContent` renderer with a shared pure `drawScene`, dataUrl-keyed decode cache, and `canvas.renderScale: true`; GIF pixel readback through WebGL `readPixels`.
- Timeline: playback mode with a 1.5s reference-derived seamless forward-only loop.
- Layers: none — single-composite product.
- Controls: entity-grouped sections (Section images / Frames / Frame Style / Background / Image Export / Video Export) with `visibleWhen` branch gating and the required Background Include row.
- Export: Export GIF (gifenc), Export Video (MediaRecorder with capability fallback), Export PNG/JPG (`createToolcraftPngExportCanvas`), all async with progress.
- Persistence: none (explicit ephemeral-tool policy).

## Evidence

- Reviewed files and contracts: AGENTS.md, docs/toolcraft/workflow.md, assembly-workflow.md, schema-reference.md, component-rules.md, acceptance-testing.md, performance.md, renderer-technique.md; contract rules video-reference-analysis, output-export-required, controls-product-coverage, performance-coverage-levels.
- References: the provided reference video and its six ffmpeg-extracted storyboard frames, declared in `appTransferMode.videoReferenceStudy`.
- Implementation evidence: `src/app/scene.ts`, `src/app/product-renderer.tsx`, exporters in `src/app/export-*.ts`, schema in `src/app/app-schema.ts`, acceptance matrix in `src/app/app-acceptance.ts`, performance matrix in `src/app/app-performance.ts`, browser tests in `e2e/app-product.spec.ts` and `e2e/app-perf-scenarios.spec.ts`.

## Verification

- Verification tier: Tier 4 (fresh generated app completion with a dependency change).
- `pnpm verify:final` passed: `node scripts/check-toolcraft-docs.mjs`, `node scripts/check-toolcraft-integrity.mjs`, `node --test scripts/*.test.mjs`, `vitest run src`, `tsc --noEmit` + `vite build`, and `pnpm test:browser` (Playwright functional browser acceptance, excluding `browser perf:` tests).
- Browser performance checkpoint passed; runner: playwright-fallback via `pnpm verify:perf` (performance audit plus all `browser perf:` budget scenarios with one worker). Fallback reason: no agent-controlled browser was attached to the local dev server in this automation environment.
- Local run: `pnpm dev` serving the app with the Toolcraft server identity and `toolcraft-app-title` check.

## Risks

- Risk: MP4 recording support depends on the browser; without `video/mp4` MediaRecorder support the export falls back to WebM (covered by the format acceptance test).
- Risk: GIF export duration fidelity is quantized to whole-frame delays; extremely short per-frame slots clamp to a 20ms minimum delay.
- Risk: Real-time MediaRecorder capture paces frames over wall-clock time; the renderer is cheap (two drawImage calls per frame) so duration matches the timeline within tolerance, but a future heavy renderer change should switch to offline WebCodecs encoding with timeline timestamps.
