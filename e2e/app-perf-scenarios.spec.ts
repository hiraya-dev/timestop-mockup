import { expect, test, type Page } from "@playwright/test";

import { appPerformance } from "../src/app/app-performance";
import {
  clickFooterActionAndDownload,
  openApp,
  pauseTimeline,
  playTimeline,
  selectComboOption,
  svgImageFile,
  toggleSwitchByName,
  uploadImagesToField,
} from "./app-helpers";
import {
  applyToolcraftPerformanceStressFixture,
  applyToolcraftPerformanceWorkloadFixture,
  dragToolcraftCanvasViewport,
  dragToolcraftSliderByLabel,
  dragToolcraftSliderToPerformanceStressValue,
  dragToolcraftSliderToValue,
  expectToolcraftCanvasBackingPixelsForRenderScale,
  expectToolcraftCanvasViewportStable,
  expectToolcraftScenarioPerformanceBudget,
  getToolcraftPerformanceStressValue,
  getToolcraftPerformanceWorkloadValue,
  measureToolcraftAnimationFrames,
  measureToolcraftInteraction,
  waitForToolcraftAnimationFrames,
  zoomToolcraftCanvasViewport,
} from "./performance-helpers";

const productCanvasSelector = "[data-toolcraft-product-output]";

type MediaSize = { height: number; width: number };

function isMediaSize(value: unknown): value is MediaSize {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as MediaSize).width === "number" &&
    typeof (value as MediaSize).height === "number"
  );
}

// Control-responsiveness scenarios pause the autoplay loop so the measurement
// isolates the control interaction cost. Concurrent playback rendering is
// guaranteed separately by the timeline/animation scenarios.
async function uploadSectionMedia(page: Page, size: MediaSize, name = "perf-media"): Promise<void> {
  await uploadImagesToField(page, "Section images", [
    svgImageFile(`${name}.svg`, "#d94040", size.width, size.height, "#101010"),
  ]);
  await waitForToolcraftAnimationFrames(page, 8);
  await pauseTimeline(page);
  await waitForToolcraftAnimationFrames(page, 4);
}

async function uploadTwoSectionMedia(page: Page, size: MediaSize): Promise<void> {
  await uploadImagesToField(page, "Section images", [
    svgImageFile("perf-a.svg", "#d94040", size.width, size.height, "#101010"),
    svgImageFile("perf-b.svg", "#2f6fd9", size.width, size.height, "#f0f0f0"),
  ]);
  await waitForToolcraftAnimationFrames(page, 8);
  await pauseTimeline(page);
  await waitForToolcraftAnimationFrames(page, 4);
}

// The Resolution scale slider defaults to its maximum (2). Keyboard End/Home
// reach the discrete endpoints deterministically, unlike a pointer drag onto a
// thumb that is already at the target position.
async function setRenderScale(page: Page, renderScale: number): Promise<void> {
  const slider = page
    .locator('[data-slot="field"]')
    .filter({ hasText: /^Resolution scale/ })
    .first()
    .getByRole("slider")
    .first();

  await slider.scrollIntoViewIfNeeded();
  await slider.focus();
  await page.keyboard.press(renderScale >= 2 ? "End" : "Home");

  if (renderScale > 1 && renderScale < 2) {
    // Step up from the minimum to the requested discrete value (0.25 steps).
    await page.keyboard.press("Home");
    const steps = Math.round((renderScale - 1) / 0.25);

    for (let step = 0; step < steps; step += 1) {
      await page.keyboard.press("ArrowRight");
    }
  }

  await waitForToolcraftAnimationFrames(page, 4);
  await expectToolcraftCanvasBackingPixelsForRenderScale(
    page,
    productCanvasSelector,
    renderScale,
  );
}

test.describe("browser perf scenarios", () => {
  test("browser perf: preview render stays responsive with 4k section media", async ({
    page,
  }) => {
    await openApp(page);

    const media = getToolcraftPerformanceStressValue<MediaSize>(
      appPerformance,
      "preview-render-max-media",
    );
    const result = await measureToolcraftInteraction(
      page,
      async () => {
        await uploadSectionMedia(page, media);
      },
      { settleFrames: 12 },
    );

    // The declared render surface stays present after the heavy preview render.
    await expect(page.locator("[data-toolcraft-product-output]").first()).toBeVisible();

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(
      { ...result, previewMs: result.durationMs },
      appPerformance,
      "preview-render-max-media",
    );
  });

  test("browser perf: frame scale drag stays live with 4k media at render scale 2", async ({
    page,
  }) => {
    await openApp(page);
    await applyToolcraftPerformanceWorkloadFixture(page, appPerformance, "frame-scale-drag", {
      renderScale: async (value) => {
        await setRenderScale(page, Number(value));
      },
      sourceMedia: async (value) => {
        if (!isMediaSize(value)) {
          throw new Error("frame-scale-drag workload sourceMedia must be a media size.");
        }

        await uploadSectionMedia(page, value);
      },
    });

    // Warm up from the low end with a real pointer drag, then measure the drag
    // to the exact declared stress value.
    await dragToolcraftSliderByLabel(page, "Scale", 0.1);

    const result = await measureToolcraftInteraction(
      page,
      async () => {
        await dragToolcraftSliderToPerformanceStressValue(
          page,
          "Scale",
          appPerformance,
          "frame-scale-drag",
        );
      },
      { settleFrames: 6 },
    );

    await expectToolcraftCanvasBackingPixelsForRenderScale(page, productCanvasSelector, 2);
    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(result, appPerformance, "frame-scale-drag");
  });

  test("browser perf: corner radius drag stays live with heavy media", async ({ page }) => {
    await openApp(page);

    const workloadMedia = getToolcraftPerformanceWorkloadValue(
      appPerformance,
      "corner-radius-drag",
    );

    if (!isMediaSize(workloadMedia)) {
      throw new Error("corner-radius-drag workload fixture must be a media size.");
    }

    await uploadSectionMedia(page, workloadMedia);

    // Warm up from the low end with a real pointer drag, then measure the drag
    // to the exact declared stress value.
    await dragToolcraftSliderByLabel(page, "Corner radius", 0.1);

    const result = await measureToolcraftInteraction(
      page,
      async () => {
        await dragToolcraftSliderToPerformanceStressValue(
          page,
          "Corner radius",
          appPerformance,
          "corner-radius-drag",
        );
      },
      { settleFrames: 6 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(result, appPerformance, "corner-radius-drag");
  });

  test("browser perf: background blur drag stays live with a heavy backdrop", async ({
    page,
  }) => {
    await openApp(page);

    const backdropMedia = getToolcraftPerformanceWorkloadValue<MediaSize>(
      appPerformance,
      "background-blur-drag",
    );

    await uploadSectionMedia(page, backdropMedia);
    await selectComboOption(page, "Type", "Image");
    await uploadImagesToField(page, "Backdrop image", [
      svgImageFile("perf-blur-backdrop.svg", "#0b3d0b", backdropMedia.width, backdropMedia.height),
    ]);
    await waitForToolcraftAnimationFrames(page, 8);

    // Warm up from the low end with a real pointer drag, then measure the drag
    // to the exact declared stress value.
    await dragToolcraftSliderByLabel(page, "Blur", 0.1);

    const result = await measureToolcraftInteraction(
      page,
      async () => {
        await dragToolcraftSliderToPerformanceStressValue(
          page,
          "Blur",
          appPerformance,
          "background-blur-drag",
        );
      },
      { settleFrames: 6 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(result, appPerformance, "background-blur-drag");
  });

  test("browser perf: crossfade transition keeps playback responsive", async ({ page }) => {
    await openApp(page);

    const workloadMedia = getToolcraftPerformanceWorkloadValue(
      appPerformance,
      "transition-change",
    );

    if (!isMediaSize(workloadMedia)) {
      throw new Error("transition-change workload fixture must be a media size.");
    }

    // Measured with playback paused so the number reflects the control change
    // and the resulting crossfade composite cost; during-playback crossfade
    // smoothness is covered by the timeline-playback-crossfade scenario.
    await uploadTwoSectionMedia(page, workloadMedia);

    const stressValue = String(
      getToolcraftPerformanceStressValue(appPerformance, "transition-change"),
    );
    const result = await measureToolcraftInteraction(
      page,
      async () => {
        const combo = page
          .locator('[data-slot="field"]')
          .filter({ hasText: /^Transition/ })
          .filter({ has: page.getByRole("combobox") })
          .nth(0)
          .getByRole("combobox")
          .first();
        await combo.click();
        await page
          .locator('[data-slot="select-item"]')
          .filter({ hasText: stressValue === "crossfade" ? /^Crossfade$/ : /^Cut$/ })
          .first()
          .click();
      },
      { settleFrames: 10 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(result, appPerformance, "transition-change");
  });

  test("browser perf: image backdrop mode keeps control changes responsive", async ({
    page,
  }) => {
    await openApp(page);

    const workloadMedia = getToolcraftPerformanceWorkloadValue(
      appPerformance,
      "background-mode-change",
    );

    if (!isMediaSize(workloadMedia)) {
      throw new Error("background-mode-change workload fixture must be a media size.");
    }

    await uploadSectionMedia(page, workloadMedia);

    const stressValue = String(
      getToolcraftPerformanceStressValue(appPerformance, "background-mode-change"),
    );

    expect(stressValue).toBe("image");
    await selectComboOption(page, "Type", "Image");
    await uploadImagesToField(page, "Backdrop image", [
      svgImageFile("perf-backdrop.svg", "#0b3d0b", workloadMedia.width, workloadMedia.height),
    ]);
    await waitForToolcraftAnimationFrames(page, 8);

    const result = await measureToolcraftInteraction(
      page,
      async () => {
        const typeCombo = page
          .locator('[data-slot="field"]')
          .filter({ hasText: /^Type/ })
          .filter({ has: page.getByRole("combobox") })
          .nth(0)
          .getByRole("combobox")
          .first();
        await typeCombo.click();
        await page
          .locator('[data-slot="select-item"]')
          .filter({ hasText: /^Solid$/ })
          .first()
          .click();
        await typeCombo.click();
        await page
          .locator('[data-slot="select-item"]')
          .filter({ hasText: /^Image$/ })
          .first()
          .click();
      },
      { settleFrames: 8 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(
      result,
      appPerformance,
      "background-mode-change",
    );
  });

  test("browser perf: importing a 4k backdrop image stays within budget", async ({ page }) => {
    await openApp(page);

    const media = getToolcraftPerformanceStressValue<MediaSize>(
      appPerformance,
      "background-image-import",
    );

    await uploadSectionMedia(page, { height: 1080, width: 1920 });
    await selectComboOption(page, "Type", "Image");

    const result = await measureToolcraftInteraction(
      page,
      async () => {
        await uploadImagesToField(page, "Backdrop image", [
          svgImageFile("perf-backdrop-import.svg", "#301040", media.width, media.height),
        ]);
      },
      { settleFrames: 10 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(
      result,
      appPerformance,
      "background-image-import",
    );
  });

  test("browser perf: frame shadow toggle keeps the canvas responsive", async ({ page }) => {
    await openApp(page);

    const workloadMedia = getToolcraftPerformanceWorkloadValue(
      appPerformance,
      "frame-shadow-change",
    );

    if (!isMediaSize(workloadMedia)) {
      throw new Error("frame-shadow-change workload fixture must be a media size.");
    }

    await uploadSectionMedia(page, workloadMedia);
    await dragToolcraftSliderToValue(page, "Scale", 100);

    const stressValue = Boolean(
      getToolcraftPerformanceStressValue(appPerformance, "frame-shadow-change"),
    );
    const result = await measureToolcraftInteraction(
      page,
      async () => {
        // Toggle off/on so the measured end state matches the stress value (on).
        const shadowSwitch = page
          .locator('[data-slot="field"]')
          .filter({ has: page.getByText("Shadow", { exact: true }) })
          .filter({ has: page.getByRole("switch") })
          .first()
          .getByRole("switch")
          .first();
        await shadowSwitch.click();

        if (stressValue) {
          await shadowSwitch.click();
        }
      },
      { settleFrames: 8 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(result, appPerformance, "frame-shadow-change");
  });

  test("browser perf: include background toggle stays responsive", async ({ page }) => {
    await openApp(page);
    await uploadSectionMedia(page, { height: 1080, width: 1920 });

    const result = await measureToolcraftInteraction(
      page,
      async () => {
        const includeSwitch = page
          .locator('[data-slot="field"]')
          .filter({ has: page.getByText("Include", { exact: true }) })
          .filter({ has: page.getByRole("switch") })
          .first()
          .getByRole("switch")
          .first();
        await includeSwitch.click();
        await includeSwitch.click();
      },
      { settleFrames: 6 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(
      result,
      appPerformance,
      "include-background-change",
    );
  });

  test("browser perf: background color changes stay responsive", async ({ page }) => {
    await openApp(page);
    await uploadSectionMedia(page, { height: 1080, width: 1920 });

    const hexInput = page.locator('input[aria-label$="hex"]').first();
    const result = await measureToolcraftInteraction(
      page,
      async () => {
        await hexInput.fill("22AA88");
        await hexInput.press("Enter");
      },
      { settleFrames: 6 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(
      result,
      appPerformance,
      "background-color-change",
    );
  });

  test("browser perf: gradient edits keep the backdrop responsive", async ({ page }) => {
    await openApp(page);
    await uploadSectionMedia(page, { height: 1080, width: 1920 });
    await selectComboOption(page, "Type", "Gradient");
    await waitForToolcraftAnimationFrames(page, 6);

    const angleInput = page.getByLabel("Gradient angle").first();
    const result = await measureToolcraftInteraction(
      page,
      async () => {
        await angleInput.fill("225");
        await angleInput.press("Enter");
      },
      { settleFrames: 6 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(
      result,
      appPerformance,
      "background-gradient-change",
    );
  });

  test("browser perf: image export format change stays responsive", async ({ page }) => {
    await openApp(page);
    await uploadSectionMedia(page, { height: 1080, width: 1920 });

    const result = await measureToolcraftInteraction(
      page,
      async () => {
        const combo = page
          .locator('[data-slot="field"]')
          .filter({ hasText: /^Format/ })
          .filter({ has: page.getByRole("combobox") })
          .nth(0)
          .getByRole("combobox")
          .first();
        await combo.click();
        await page
          .locator('[data-slot="select-item"]')
          .filter({ hasText: /^JPG$/ })
          .first()
          .click();
      },
      { settleFrames: 4 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(result, appPerformance, "image-format-change");
  });

  test("browser perf: video export format change stays responsive", async ({ page }) => {
    await openApp(page);
    await uploadSectionMedia(page, { height: 1080, width: 1920 });

    const result = await measureToolcraftInteraction(
      page,
      async () => {
        const combo = page
          .locator('[data-slot="field"]')
          .filter({ hasText: /^Format/ })
          .filter({ has: page.getByRole("combobox") })
          .nth(1)
          .getByRole("combobox")
          .first();
        await combo.click();
        await page
          .locator('[data-slot="select-item"]')
          .filter({ hasText: /^WebM$/ })
          .first()
          .click();
      },
      { settleFrames: 4 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(result, appPerformance, "video-format-change");
  });

  test("browser perf: importing 4k section media stays within budget", async ({ page }) => {
    await openApp(page);

    const media = getToolcraftPerformanceStressValue<MediaSize>(
      appPerformance,
      "media-import-4k",
    );
    const result = await measureToolcraftInteraction(
      page,
      async () => {
        await uploadSectionMedia(page, media, "perf-import");
      },
      { settleFrames: 10 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(result, appPerformance, "media-import-4k");
  });

  test("browser perf: 8k png export completes within the export budget", async ({ page }) => {
    test.setTimeout(120_000);
    await openApp(page);

    const media = appPerformance.scenarios.find(
      (scenario) => scenario.id === "preview-render-max-media",
    )?.stressFixture?.value;

    if (!isMediaSize(media)) {
      throw new Error("preview-render stress fixture must be a media size.");
    }

    await uploadSectionMedia(page, media);

    const resolution = String(
      getToolcraftPerformanceStressValue(appPerformance, "export-image-8k"),
    );

    await selectComboOption(page, "Resolution", resolution.toUpperCase());

    let pngBuffer: Buffer | undefined;
    const result = await measureToolcraftInteraction(page, async () => {
      const download = await clickFooterActionAndDownload(page, "Export PNG", 60_000);
      pngBuffer = download.buffer;
    });

    expect(pngBuffer?.length ?? 0).toBeGreaterThan(0);
    expectToolcraftScenarioPerformanceBudget(
      { ...result, exportMs: result.durationMs },
      appPerformance,
      "export-image-8k",
    );
  });

  test("browser perf: image export resolution change stays responsive", async ({ page }) => {
    await openApp(page);
    const baseline = getToolcraftPerformanceWorkloadValue<MediaSize>(
      appPerformance,
      "image-resolution-change",
    );
    await uploadSectionMedia(page, baseline);

    const resolution = String(
      getToolcraftPerformanceStressValue(appPerformance, "image-resolution-change"),
    ).toUpperCase();
    const result = await measureToolcraftInteraction(
      page,
      async () => {
        const combo = page
          .locator('[data-slot="field"]')
          .filter({ hasText: /^Resolution/ })
          .filter({ has: page.getByRole("combobox") })
          .nth(0)
          .getByRole("combobox")
          .first();
        await combo.click();
        await page
          .locator('[data-slot="select-item"]')
          .filter({ hasText: new RegExp(`^${resolution}$`) })
          .first()
          .click();
      },
      { settleFrames: 4 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(
      result,
      appPerformance,
      "image-resolution-change",
    );
  });

  test("browser perf: 4k video export completes within the export budget", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openApp(page);
    await uploadSectionMedia(page, { height: 1080, width: 1920 });

    const resolution = String(
      getToolcraftPerformanceStressValue(appPerformance, "export-video-4k"),
    );

    await selectComboOption(page, "Resolution", resolution === "4k" ? "4K" : "Current", 1);

    let videoBuffer: Buffer | undefined;
    const result = await measureToolcraftInteraction(page, async () => {
      const download = await clickFooterActionAndDownload(page, "Export Video", 90_000);
      videoBuffer = download.buffer;
    });

    expect(videoBuffer?.length ?? 0).toBeGreaterThan(0);
    expectToolcraftScenarioPerformanceBudget(
      { ...result, exportMs: result.durationMs },
      appPerformance,
      "export-video-4k",
    );
  });

  test("browser perf: video export resolution change stays responsive", async ({ page }) => {
    await openApp(page);
    const baseline = getToolcraftPerformanceWorkloadValue<MediaSize>(
      appPerformance,
      "video-resolution-change",
    );
    await uploadSectionMedia(page, baseline);

    const resolution =
      String(getToolcraftPerformanceStressValue(appPerformance, "video-resolution-change")) === "4k"
        ? "4K"
        : "Current";
    const result = await measureToolcraftInteraction(
      page,
      async () => {
        const combo = page
          .locator('[data-slot="field"]')
          .filter({ hasText: /^Resolution/ })
          .filter({ has: page.getByRole("combobox") })
          .nth(1)
          .getByRole("combobox")
          .first();
        await combo.click();
        await page
          .locator('[data-slot="select-item"]')
          .filter({ hasText: new RegExp(`^${resolution}$`) })
          .first()
          .click();
      },
      { settleFrames: 4 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(
      result,
      appPerformance,
      "video-resolution-change",
    );
  });

  test("browser perf: timeline playback samples frames without jank", async ({ page }) => {
    await openApp(page);
    await applyToolcraftPerformanceStressFixture(
      page,
      appPerformance,
      "timeline-playback-crossfade",
      {
        sourceMedia: async (value) => {
          if (!isMediaSize(value)) {
            throw new Error("timeline playback sourceMedia must be a media size.");
          }

          await uploadTwoSectionMedia(page, value);
        },
        transition: async (value) => {
          await selectComboOption(
            page,
            "Transition",
            String(value) === "crossfade" ? "Crossfade" : "Cut",
          );
        },
      },
    );

    // Start playback and let the first heavy render settle, then measure
    // steady-state crossfade frame gaps over a full loop.
    await page.getByRole("button", { name: "Play playback" }).first().click();
    await waitForToolcraftAnimationFrames(page, 24);

    const result = await measureToolcraftInteraction(
      page,
      async () => {
        // Playback is already running; sample steady-state frames and confirm
        // the Pause playback transport stays available throughout.
        await waitForToolcraftAnimationFrames(page, 150);
        await expect(
          page.getByRole("button", { name: "Pause playback" }).first(),
        ).toBeVisible();
      },
      { settleFrames: 2 },
    );

    await pauseTimeline(page);
    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(
      result,
      appPerformance,
      "timeline-playback-crossfade",
    );
  });

  test("browser perf: dragging the viewport during playback stays smooth", async ({
    page,
  }) => {
    await openApp(page);
    await applyToolcraftPerformanceStressFixture(
      page,
      appPerformance,
      "animation-viewport-drag",
      {
        sourceMedia: async (value) => {
          if (!isMediaSize(value)) {
            throw new Error("animation-viewport-drag sourceMedia must be a media size.");
          }

          await uploadTwoSectionMedia(page, value);
        },
        transition: async (value) => {
          await selectComboOption(
            page,
            "Transition",
            String(value) === "crossfade" ? "Crossfade" : "Cut",
          );
        },
      },
    );

    await playTimeline(page);

    // The canvas world layer carries the pan offset in its transform matrix.
    const readWorldTransform = () =>
      page
        .locator("[data-toolcraft-canvas-world]")
        .first()
        .evaluate((element) => window.getComputedStyle(element).transform);
    const transformBefore = await readWorldTransform();
    const result = await measureToolcraftInteraction(
      page,
      async () => {
        await dragToolcraftCanvasViewport(page, { x: 160, y: 90 });
      },
      { settleFrames: 10 },
    );

    // Playback must stay running after the drag (interaction throttling must
    // not flip the user's play state), and the viewport pan must have applied.
    await expect(page.getByRole("button", { name: "Pause playback" }).first()).toBeVisible();

    const transformAfter = await readWorldTransform();

    expect(transformAfter, "viewport drag must pan the canvas world").not.toBe(
      transformBefore,
    );
    await pauseTimeline(page);
    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(
      result,
      appPerformance,
      "animation-viewport-drag",
    );
  });

  test("browser perf: toolbar zoom under stress keeps frame gaps within budget", async ({
    page,
  }) => {
    await openApp(page);
    await applyToolcraftPerformanceStressFixture(page, appPerformance, "viewport-zoom-stress", {
      renderScale: async (value) => {
        await setRenderScale(page, Number(value));
      },
      scale: async (value) => {
        await dragToolcraftSliderToValue(page, "Scale", Number(value));
      },
      sourceMedia: async (value) => {
        if (!isMediaSize(value)) {
          throw new Error("viewport-zoom-stress sourceMedia must be a media size.");
        }

        await uploadTwoSectionMedia(page, value);
      },
    });
    await selectComboOption(page, "Transition", "Crossfade");
    // Prove the stress fixture actually applied renderScale 2 to the backing
    // canvas pixels before zooming.
    await expectToolcraftCanvasBackingPixelsForRenderScale(
      page,
      "[data-toolcraft-product-output]",
      2,
    );
    // Keep the combined worst-case render state (1080p media, renderScale 2,
    // Scale 100, crossfade) but pause the autoplay loop so the zoom measurement
    // reflects zoom cost against the heavy state rather than accumulated
    // playback wait time. Playback-time smoothness is covered separately.
    await pauseTimeline(page);
    await waitForToolcraftAnimationFrames(page, 4);

    const result = await measureToolcraftInteraction(
      page,
      async () => {
        await zoomToolcraftCanvasViewport(page, 3);
      },
      { settleFrames: 10 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(result, appPerformance, "viewport-zoom-stress");
  });

  test("browser perf: panel interactions keep the canvas viewport stable", async ({ page }) => {
    await openApp(page);
    await uploadSectionMedia(page, { height: 1080, width: 1920 });

    const result = await expectToolcraftCanvasViewportStable(
      page,
      async () => {
        await dragToolcraftSliderToValue(page, "Scale", 45);
        await toggleSwitchByName(page, "Shadow");
        await toggleSwitchByName(page, "Shadow");
      },
      { settleFrames: 6 },
    );

    await expect(
      page.locator("[data-toolcraft-product-output]").first(),
      "the product canvas must stay rendered after the measured interaction",
    ).toBeVisible();
    expectToolcraftScenarioPerformanceBudget(result, appPerformance, "viewport-stability");
  });
});
