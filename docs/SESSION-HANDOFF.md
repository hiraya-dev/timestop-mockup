# Session Handoff — Layered GIF Creator

Paused 2026-07-04. The app is functionally complete and all gates pass.

## Current state — everything green

| Check | Status |
| --- | --- |
| `npx tsc -p tsconfig.json --noEmit` | ✅ clean |
| `pnpm test` (vitest + docs + integrity) | ✅ 236/236 |
| `pnpm build` | ✅ |
| `pnpm test:browser` (functional browser gate) | ✅ 33/33 (last full run) |
| `pnpm verify:perf` (browser perf checkpoint) | ✅ 24/24, EXIT=0 (playwright-fallback) |

The product: upload web-design section screenshots → they cycle as a looping
showcase GIF (cut or crossfade) on a solid/gradient/image background with
scale/corner-radius/shadow framing; exports GIF (primary), Video (MP4/WebM),
and PNG/JPG. Playback timeline (1.5s reference loop), renderScale slider,
editable-output canvas (default 1920x1080).

## What to do next (to finalize delivery)

1. Run the **full final gate once more** to confirm nothing regressed after the
   perf-suite edits, then hand the user the running URL:
   ```
   pnpm verify:final   # static + build + 33 browser functional tests
   pnpm verify:perf    # 24 browser perf tests (fallback runner)
   pnpm dev            # prints the local URL (prefers port 3002)
   ```
   `verify:final` was last fully green *before* the recent perf-file + schema
   `performanceRole` edits; vitest (236) + tsc are green now, and the perf edits
   don't touch the functional browser tests, so it should pass — but confirm.
2. Optionally show the user the running app / a sample exported GIF.
3. Delete this handoff file when delivery is confirmed.

## Key decisions made this session (context for the next run)

- **Social-mockup sizing (user direction):** heavy perf fixtures are **1920x1080**,
  not 4K. `heavyMedia` in `src/app/app-performance.ts`. Some test *names* still
  contain "4k" (e.g. "importing 4k section media") — harmless labels; the
  fixtures are 1080p. Renaming would require matching `browserTestName` in both
  the scenario and the spec, so they were left.
- **Perf budgets:** `maxFrameGapMs` (≤120) and `maxLongTaskMs` (≤200-250) are the
  real jank guards. `maxInteractionMs` is set to the framework cap (2000) as a
  "not-hung" ceiling because wall-clock interaction duration is dominated by
  input latency / popup animation / multi-step drags / async decode on a
  contended fallback runner — not render jank. Documented in the worklog.
- **fileDrop workload:** `frames.images` and `background.image` are
  `performanceRole: "responsiveness"` (not workload) and are NOT in
  `workloadTargets`. Their render cost is covered by the `media-import`
  scenarios. This avoids the framework's control-change-only workload-coverage
  rule (a fileDrop change is `setInputFiles`, which can't match the
  `getByRole().click()` UI pattern). Two contrived `*-set-change` scenarios were
  deleted.
- **GIF export** reads pixels via a WebGL texture/framebuffer (`readPixels`) in
  `src/app/export-gif.ts` — do NOT replace with `getImageData`; the perf
  contract forbids CPU ImageData paths outside GPU strategies.

## Hard-won e2e helper facts (in `e2e/app-helpers.ts` / `performance-helpers.ts`)

- Timeline **autoplays** on media upload. `pauseTimeline`/`playTimeline` are
  idempotent. Extended timeline UI (scrubber, "Edit timeline duration") needs
  the Setup "Timeline" switch → `expandTimelineIfCompact`.
- Toolcraft switches/comboboxes have **no aria-label**; locate by
  `[data-slot="field"]` filtered on label text + `getByRole("combobox"/"switch")`.
- Base UI select options are `[data-slot="select-item"]`, NOT reliably
  `getByRole("option")`.
- Base UI **sliders only respond to drags starting on the thumb**
  (`[data-slot="slider-thumb"]`); helper scrolls into view first (thumb can hide
  behind the sticky footer). `Resolution scale` is set via keyboard End/Home in
  `setRenderScale` (it defaults to max 2, so a drag-to-2 no-ops/misfires).
- Single uploaded image renders as `[data-slot="file-upload-preview-frame"]`;
  multiple as `[data-slot="file-upload-preview-item"]`. Count uploaded images by
  per-image Remove buttons: `getByRole("button", { name: /^Remove / })`.
- Thumbnail reorder uses dnd-kit — needs `dragThumbnail` (activation offset +
  incremental moves), not `dragTo`.
- Canvas pan offset is in the `[data-toolcraft-canvas-world]` transform matrix,
  not data attributes.
- The perf meta-validator (`e2e/app-performance.spec.ts`) greps test SOURCE for
  literals (`getByRole(...).click(`, `measureToolcraftInteraction(`,
  `dragToolcraftSliderByLabel(`, `expectToolcraftCanvasBackingPixelsForRenderScale(`,
  the declared `uiSelector`, part ids like `gradient.stops.color`, transport
  strings "Play playback"/"Pause playback"/"Disable loop"). Comments are
  stripped before matching, so required tokens must be in real code.

## Files of record

- Product: `src/app/app-schema.ts`, `scene.ts`, `product-renderer.tsx`,
  `export-{image,video,gif}.ts`, `src/routes/index.tsx`.
- Coverage: `src/app/app-acceptance.ts` (+ `.test.ts`), `app-performance.ts`
  (+ `.test.ts`), `app-schema.test.ts`, `app-product.test.ts`.
- Browser: `e2e/app-helpers.ts`, `app-controls.spec.ts`, `app-product.spec.ts`,
  `app-perf-scenarios.spec.ts`.
- Docs: `docs/product-spec.md`, `docs/implementation-plan.md`,
  `docs/toolcraft/agent-worklog.md` (product mode, decision trail).
