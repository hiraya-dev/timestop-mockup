# Layered GIF Creator — Product Spec

## Request

Create a GIF generator that takes images as input, used to showcase section UI
from web designs. Background is configurable: image, solid color, or gradient.
Reference: `~/Downloads/63dba3fdfa6d75604436eae5ebde4d4f_720w.mp4` (Everbloom
brand lookbook, 1.4667s, 678x904, hard cuts between shots).

## Video Reference Study (summary)

Frames extracted with `ffmpeg -vf fps=4` into 6 frames. Behavior observed:

- f01 (0.00s): close-up shot 1 — woven label centered on dark textile.
- f02 (0.25s): hard cut to shot 2 — different crop/material, subject centered.
- f03 (0.50s): hard cut to shot 3 — knit collar with black label centered.
- f04 (0.75s): hard cut to shot 4 — new material/crop.
- f05 (1.00s): hard cut to shot 5.
- f06 (1.25s): hard cut to shot 6 — white card on textured throw; loops back to f01.

Transitions: every cut is a hard cut (no dissolve/motion); the subject stays
roughly centered; per-shot duration is uniform (~0.24s); the sequence loops
seamlessly forward (last shot cuts back to the first).

Behavior decomposition to copy:
1. A sequence of uploaded images plays as equal-duration frames.
2. Cuts are hard by default (crossfade offered as an option).
3. The loop is seamless forward-only: last frame stitches to first.
4. Each image is presented centered on a styled backdrop.

## Product

Upload one or more web-design section screenshots; they cycle as GIF frames on
a configurable background (solid / gradient / image). Export GIF (primary
product output), plus Export Video and Export PNG per the Toolcraft contract.

## Controls (sections)

1. **Frames** — `frames.images` fileDrop (image, multiple, sortable order =
   frame order); `frames.transition` select Cut | Crossfade (orderRole mode).
2. **Frame Style** — `frame.scale` slider 20–100 % (default 70);
   `frame.cornerRadius` slider 0–80 px (default 16); `frame.shadow` switch
   (default on).
3. **Background** (required, before Image Export) — `background.mode` select
   Solid | Gradient | Image (orderRole mode, default solid); inline row
   [`export.includeBackground` switch "Include", `background.color` color
   label:false (visibleWhen solid)]; `background.gradient` gradient
   (visibleWhen gradient); `background.image` fileDrop single (visibleWhen
   image, cover/crop).
4. **Image Export** — `export.image.format` png|jpg, `export.image.resolution`
   2k|4k|8k (inline pair).
5. **Video Export** — `export.video.format` mp4|webm, `export.video.resolution`
   current|4k (inline pair, final authored section).

Footer panelActions: `Export Video` (primary), `Export GIF`, `Export PNG`
(all icon upload-simple; async, real Promise + reportProgress).

## Canvas / Timeline / Layers

- Canvas: `editable-output`, default 1920x1080, `canvas.renderScale: true`
  (Canvas 2D raster preview). Uploaded images render inside current canvas
  bounds (frame images contain-fit at `frame.scale`; background image
  cover/crop). No layers (single-composite product).
- Timeline: playback mode, `defaultDurationSeconds: 1.5` — loopDuration
  source `reference`, evidence: ffprobe duration 1.4667s of the provided
  reference video, rounded to 1.5s. Renderer maps one full frame cycle to
  `state.timeline.durationSeconds` via `getToolcraftTimelineLoopProgress`;
  forward-only, first/last frames stitch (frame N crossfades/cuts to frame 0).

## Renderer

Canvas 2D (medium raster compositing — drawImage of decoded uploads; no
per-pixel CPU processing, so WebGL not required; recorded in
`rendererTechnique.whyNotAlternativeStrategies`). Pure scene draw function
shared by preview, PNG, video, and GIF exporters. Decoded-image cache keyed by
dataUrl. Animation work suspends during canvas drag/zoom interactions and
resumes at correct timeline time.

## Export

- PNG: `createToolcraftPngExportCanvas({ background, includeBackground,
  resolution, state, render })` at current timeline frame.
- Video: `MediaRecorder.isTypeSupported` selects mp4 or webm (safe fallback to
  webm); offscreen canvas at `getToolcraftVideoExportSize`; frames rendered
  from timeline time paced over exactly `durationSeconds`; frame-based
  reportProgress.
- GIF: `gifenc` encoder (new dependency). Cut mode: one GIF frame per image,
  delay = duration / frameCount. Crossfade mode: 20fps sampling. Current
  canvas size, encoder progress reported.

## Persistence

None (explicit policy): this is an ephemeral composition tool; settings
export/import in runtime Setup covers transfer. No localStorage.

## Ambiguity resolutions

- "GIF generator with images as input" → multi-image fileDrop is the frame
  source; no placeholder artwork before upload.
- Cadence/loop from the reference video (1.5s, hard cuts, uniform timing).
- Crossfade added as the only transition option beyond the reference cut.

## Renderer Technique Decision Matrix

- `sourceRepresentation`: image-media — uploaded section screenshots and backdrop images decoded once per dataUrl.
- `productRepresentation`: pixel — the output is exported raster pixels (PNG, video frames, GIF frames).
- `previewRenderer`: canvas-2d — the preview composites at most two cached decoded bitmaps plus one fill per frame with GPU-backed drawImage.
- `exportRenderer`: canvas-2d — PNG/video/GIF share the same pure `drawScene` path; GIF pixel readback runs through a WebGL texture/framebuffer (`readPixels`) before CPU palette quantization.
- `rendererWorkload`: pixel-output — the exported product is pixels, and GIF export includes a per-pixel quantization stage.
- `rendererStrategy`: canvas-2d for the interactive path.
- `whyNotAlternativeStrategies`: WebGL/WebGPU were evaluated as the alternative strategy but rejected for the interactive scene: there are no shaders, no dense primitive fields, and no CPU pixel loop in the preview; drawImage compositing passes the 4K + renderScale 2 stress scenarios. DOM/SVG were rejected because there is no text-output or vector-output surface — export/copy needs one pixel-identical raster path with product-quality export at `state.canvas.size`.
- `fidelityRisks`: upscaling small uploads softens edges; GIF 256-color quantization can band gradients.
- `performanceRisks`: 4K media at renderScale 2 makes composites large (mitigated by dataUrl-keyed decode cache); crossfade doubles draws at slot boundaries; GIF export quantization is CPU-bound but offline, chunked, and progress-reported.

## Renderer Layer Inventory

- `backgroundLayer` ("backdrop", kind background): solid fill, gradient fill, or cover/cropped bitmap-media, canvas-2d, low primitive count, composited into export.
- `productForegroundLayer` ("frame", kind product-foreground): the current (and crossfading next) section image with corner-radius clip and shadow, canvas-2d, low primitive count, composited into export.
- No `editingHandlesLayer`: the product has no on-canvas handles.
- `exportComposite`: PNG via `createToolcraftPngExportCanvas`, video via paced MediaRecorder frames, GIF via WebGL readback + gifenc; all reuse the same `drawScene`.

## Render Pipeline Inventory

Passes (mirrored in `rendererPipeline` in `src/app/app-performance.ts`):

1. `decode` — decode uploaded images once; cacheKey `mediaAssets[].dataUrl`; invalidated only by media-import.
2. `composite` — draw backdrop + frame(s) for the current loop progress; invalidated by control-drag (`frame.scale`, `frame.cornerRadius`), control-change (transition, shadow, background controls), timeline-playback, and media-import; must not re-decode media.
3. `export` — render final output at export dimensions; invalidated by export interactions only.

Interaction invalidation: viewport-drag and viewport-zoom invalidate nothing (animation work is coalesced during the interaction and resumes at the correct timeline time); control-drag and timeline-playback invalidate only `composite`; media-import invalidates `decode` + `composite`; animation-frame sampling reuses cached decodes.
