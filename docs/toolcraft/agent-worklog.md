# Implementation Worklog

This file records product decisions and the evidence behind them.

## Status

Mode: product

## Decision Trail

### Iteration 5 — Video export reliability fix

- Request: Video export stopped working after the PNG-matched encoder pass.
- Task type: Export bug fix in `export-video.ts` and `export-render-size.ts`.
- User-visible result: Video export works again across browsers by falling back to realtime `captureStream(30)` when manual `requestFrame` is unavailable, pacing manual frames in real time for MediaRecorder, retrying recorder bitrate setup, and fitting image-export sizes inside the encoder-safe 4K box.
- Source/reference checked: failing manual-only export path in `export-video.ts`; Toolcraft footer action error handling only logs to console.
- Reference inputs: user report that video no longer exports.
- Docs/contracts read: workflow.md, assembly-workflow.md export notes.
- Contract rules applied: output-export-required, workflow-required.
- Decision: Probe manual frame capture before choosing stream mode; replace `setTimeout(0)` frame bursts with paced async export; add recorder bitrate fallback; cap animated video render size to encoder-safe 4K even when image export is 8K.
- Alternatives rejected: keeping manual-only `requestFrame` (breaks Safari and some browsers); uncapped 8K video frames (MediaRecorder/canvas failures).
- State/output mapping: `getSceneAnimatedExportSize` now fits image-export dimensions inside `getToolcraftVideoExportSize("4k")`; `exportSceneVideo` chooses manual vs realtime capture at runtime.
- Files changed: `src/app/export-video.ts`, `src/app/export-render-size.ts`, `src/app/app-product.test.ts`.
- Verification: Tier 3 — `pnpm verify:quick`, targeted Playwright export action test.
- Skipped checks: full browser perf checkpoint.
- Risks: realtime fallback duration still follows wall clock; very long loops take proportionally longer to export.

### Iteration 4 — PNG-matched animated export quality

- Request: GIF and MP4 exports still look fuzzy; PNG quality is good but user needs animation.
- Task type: Export encoder/renderer pass for GIF and video.
- User-visible result: Video export renders offline at the same resolution path as PNG (image export resolution), encodes each timeline frame with manual `captureStream(0)` + `requestFrame`, and uses a higher bitrate; GIF export uses the same render scaling (2048px long-edge cap), skips background dither unless the backdrop is a gradient or blurred image, and keeps masked nearest-color quantization for UI frames.
- Source/reference checked: `export-image.ts`, `export-video.ts`, `export-gif.ts`, user-reported fuzzy GIF frame text and MP4 softness.
- Reference inputs: user GIF/PNG comparison samples.
- Docs/contracts read: AGENTS.md, workflow.md, renderer-technique.md.
- Contract rules applied: output-export-required, workflow-required.
- Decision: Share PNG export sizing through `getSceneAnimatedExportSize`; rewrite video export as offline frame capture instead of wall-clock `requestAnimationFrame` recording; reduce GIF grain by conditional dithering and higher render resolution.
- Alternatives rejected: GIF-only guidance (user needs animation); raising bitrate alone on realtime MediaRecorder (still misses frames and records below PNG resolution); APNG dependency in this pass (video is the full-quality animated path).
- State/output mapping: video `current` resolution follows `export.image.resolution`; video `4k` keeps `export.video.resolution`; GIF uses capped image-export sizing; render uses `paintSceneExportFrame` with high-quality image smoothing and integer frame bounds.
- Files changed: `src/app/export-render-size.ts`, `src/app/export-scene-canvas.ts`, `src/app/export-video.ts`, `src/app/export-gif.ts`, `src/app/scene.ts`, `src/app/app-product.test.ts`.
- Verification: Tier 3 — `pnpm verify:quick`.
- Skipped checks: full browser perf checkpoint (export path only).
- Risks: GIF remains 256-color; browsers without manual `requestFrame` cannot export video; larger 4K video files and slower exports.

### Iteration 3 — Sharp UI frames in GIF export

- Request: GIF export keeps canvas backgrounds smooth but UI frame screenshots (especially text) look fuzzy.
- Task type: Export encoder fix in `export-gif.ts`.
- User-visible result: GIF export builds a frame-weighted palette, dithers only the canvas background, and maps UI frame pixels with nearest-color quantization so text stays legible.
- Source/reference checked: user-provided GIF frame samples with sharp background and fuzzy framed UI text; prior reverted `frameMask` experiment in `export-gif.ts`.
- Reference inputs: user GIF/PNG export samples from Ruang mockups.
- Docs/contracts read: AGENTS.md, workflow.md, renderer-technique.md.
- Contract rules applied: output-export-required, workflow-required.
- Decision: Mask frame pixels via a background-less render pass; quantize frame and background pixels into separate palettes (200 + 56 colors); Floyd-Steinberg dither only background pixels and block error diffusion across the frame boundary.
- Alternatives rejected: disabling dither globally (regresses blurred gradient backgrounds); raising GIF long-edge only (does not fix text grain from error diffusion); PNG-only guidance without encoder fix (user needs GIF output).
- State/output mapping: no schema changes; `exportSceneGif` renders mask pass per timeline sample, then `buildGifPalette` + masked `ditherToPalette` before `gifenc` frame write.
- Files changed: `src/app/export-gif.ts`, `src/app/app-product.test.ts`.
- Verification: Tier 3 — `pnpm verify:quick`.
- Skipped checks: full browser perf checkpoint (export-only encoder pass).
- Risks: GIF remains 256-color; extremely colorful UI frames may still band slightly compared to PNG.

### Iteration 2 — Loop Frame rename and demo polish

- Request: Rename the app to Loop Frame; position it as a polished product demo, not a sellable standalone product.
- Task type: Branding/copy pass on user-facing title, export filenames, and README positioning.
- User-visible result: Browser tab, controls panel title, and export filenames use Loop Frame branding; README states portfolio/demo use and Toolcraft resale limits.
- Source/reference checked: Existing product behavior and export helpers in `src/app/export-*.ts`; Toolcraft Designer License resale limits in `LICENSE.md`.
- Reference inputs: none (rename-only pass; no new reference media).
- Docs/contracts read: AGENTS.md, workflow.md, decision-contract.md.
- Contract rules applied: workflow-required.
- Decision: Rename user-facing title to "Loop Frame"; align default export filenames to `loop-frame.*`; add README licensing note without changing product behavior.
- Alternatives rejected: "Loopframe" one-word slug (user chose two-word title); keeping legacy `layered-*` export filenames (hurts demo polish); omitting README license note (user cannot sell/resell the app as a standalone product).
- State/output mapping: No schema targets or renderer behavior changed; `controls.title`, HTML `<title>`, `productName`, and export download filenames only.
- Files changed: `index.html`, `src/app/app-schema.ts`, `src/app/app-acceptance.ts`, `src/app/export-gif.ts`, `src/app/export-image.ts`, `src/app/export-video.ts`, `README.md`, `package.json`, test describe labels in `src/app/app-product.test.ts` and `e2e/app-product.spec.ts`.
- Verification: Tier 2 — `pnpm verify:quick`.
- Skipped checks: browser rerun (no renderer/control/export behavior change).
- Risks: none; branding-only pass.

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
