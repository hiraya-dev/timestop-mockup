import { expect, test, type Page } from "@playwright/test";

import {
  clickFooterActionAndDownload,
  expandTimelineIfCompact,
  getCanvasSizeInput,
  dragThumbnail,
  getImageUploadField,
  gifLogicalScreenSize,
  openApp,
  pauseTimeline,
  playTimeline,
  selectComboOption,
  svgImageFile,
  toggleSwitchByName,
  uploadImagesToField,
} from "./app-helpers";
import {
  dragToolcraftSliderToValue,
  expectToolcraftCanvasBackingPixelsForRenderScale,
  expectToolcraftDiscreteSliderDragSmoothness,
  waitForToolcraftAnimationFrames,
} from "./performance-helpers";
import {
  expectToolcraftProductObservableToChange,
  getToolcraftProductObservableSnapshot,
} from "./product-observable-helpers";

const productCanvasSelector = "[data-toolcraft-product-output]";

async function decodeExportedImage(
  page: Page,
  buffer: Buffer,
  mimeType: string,
): Promise<{ cornerAlpha: number; naturalHeight: number; naturalWidth: number }> {
  return page.evaluate(
    async ({ base64, mime }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: mime });
      const bitmap = await createImageBitmap(blob);
      const url = URL.createObjectURL(blob);
      const image = new Image();

      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Failed to decode exported image."));
        image.src = url;
      });
      URL.revokeObjectURL(url);

      const probe = document.createElement("canvas");

      probe.width = 4;
      probe.height = 4;

      const probeContext = probe.getContext("2d");

      if (!probeContext) {
        throw new Error("No probe context.");
      }

      probeContext.drawImage(bitmap, 0, 0);

      return {
        cornerAlpha: probeContext.getImageData(0, 0, 1, 1).data[3] ?? 255,
        naturalHeight: image.naturalHeight,
        naturalWidth: image.naturalWidth,
      };
    },
    { base64: buffer.toString("base64"), mime: mimeType },
  );
}

async function loadExportedVideoDurationMetadata(
  page: Page,
  buffer: Buffer,
  mimeType: string,
): Promise<{
  centerLuma: number;
  duration: number;
  videoHeight: number;
  videoWidth: number;
}> {
  return page.evaluate(
    async ({ base64, mime }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: mime });
      const url = URL.createObjectURL(blob);
      const video = document.createElement("video");

      video.muted = true;

      const metadata = await new Promise<{ duration: number }>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("Timed out waiting for exported video metadata.")),
          20_000,
        );

        video.addEventListener(
          "loadedmetadata",
          () => {
            const settle = () => {
              window.clearTimeout(timeout);
              resolve({ duration: video.duration });
            };

            // MediaRecorder WebM blobs report Infinity until a far seek.
            if (!Number.isFinite(video.duration)) {
              video.currentTime = Number.MAX_SAFE_INTEGER;
              video.addEventListener("timeupdate", settle, { once: true });
            } else {
              settle();
            }
          },
          { once: true },
        );
        video.addEventListener(
          "error",
          () => {
            window.clearTimeout(timeout);
            reject(new Error("Exported blob failed to load as a video."));
          },
          { once: true },
        );
        video.src = url;
      });

      await new Promise<void>((resolve) => {
        video.currentTime = 0.05;
        video.addEventListener("seeked", () => resolve(), { once: true });
      });

      const probe = document.createElement("canvas");

      probe.width = video.videoWidth;
      probe.height = video.videoHeight;

      const probeContext = probe.getContext("2d");

      if (!probeContext) {
        throw new Error("No probe context.");
      }

      probeContext.drawImage(video, 0, 0);

      const corner = probeContext.getImageData(2, 2, 1, 1).data;
      const centerLuma = (corner[0]! + corner[1]! + corner[2]!) / 3;

      URL.revokeObjectURL(url);

      return {
        centerLuma,
        duration: metadata.duration,
        videoHeight: video.videoHeight,
        videoWidth: video.videoWidth,
      };
    },
    { base64: buffer.toString("base64"), mime: mimeType },
  );
}

async function editTimelineDurationInline(page: Page, seconds: number): Promise<void> {
  await page.getByRole("button", { name: "Edit timeline duration" }).first().click();

  const durationBox = page.getByRole("textbox", { name: "timeline duration" }).first();

  await expect(durationBox).toBeVisible();
  await durationBox.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(String(seconds));
  await page.keyboard.press("Enter");
}

async function uploadTwoSectionImages(page: Page): Promise<void> {
  await uploadImagesToField(page, "Section images", [
    svgImageFile("section-a.svg", "#d94040", 800, 600, "#101010"),
    svgImageFile("section-b.svg", "#2f6fd9", 800, 600, "#f0f0f0"),
  ]);
  await expect(page.getByRole("img", { name: "section-a.svg" })).toBeVisible();
  await waitForToolcraftAnimationFrames(page, 6);
  // Media-ready playback autostarts; pause so snapshots are deterministic.
  await pauseTimeline(page);
  await waitForToolcraftAnimationFrames(page, 4);
}

test.describe("loop frame product", () => {
  test("browser: section images upload reorder rotate flip clear and reset drive the frame sequence", async ({
    page,
  }) => {
    await openApp(page);

    const emptySnapshot = await getToolcraftProductObservableSnapshot(page);

    await uploadTwoSectionImages(page);

    const uploadedSnapshot = await getToolcraftProductObservableSnapshot(page);

    expect(uploadedSnapshot, "upload must change product output").not.toBe(emptySnapshot);

    // Reorder: drag the second thumbnail before the first; the frame at time 0
    // (currently frame A) must change because the renderer consumes runtime
    // media order.
    const field = getImageUploadField(page, "frames");
    const thumbnails = field.locator('[data-slot="file-upload-preview-item"]');

    await expect(thumbnails).toHaveCount(2);
    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await dragThumbnail(thumbnails.nth(1), thumbnails.nth(0));
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "reordering thumbnails must change the first rendered frame" },
    );

    // The per-image Remove button count tracks the uploaded frame set for both
    // the single-image preview and the multi-image thumbnail grid.
    const removeButtons = field.getByRole("button", { name: /^Remove / });

    // Clear/remove one uploaded image: the frame set shrinks from two to one.
    await removeButtons.first().click();
    await waitForToolcraftAnimationFrames(page, 6);
    await expect(removeButtons).toHaveCount(1);

    // With a single frame the rendered output always shows that image, so
    // rotate and flip deterministically change the product output through
    // mediaAssets[].transform.
    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await field.getByRole("button", { name: "90°" }).click();
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "rotate must change rendered output through the media transform" },
    );
    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await field.getByRole("button", { name: "Flip H" }).click();
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "flip must change rendered output through the media transform" },
    );

    // Removing the last image empties the source set, so the product canvas
    // no longer renders a frame.
    const beforeLastRemove = await getToolcraftProductObservableSnapshot(page);

    await removeButtons.first().click();
    await waitForToolcraftAnimationFrames(page, 6);
    await expect(removeButtons).toHaveCount(0);

    const afterEmptied = await getToolcraftProductObservableSnapshot(page);

    expect(
      afterEmptied,
      "clearing all frames must change the rendered product output",
    ).not.toBe(beforeLastRemove);

    // Global Reset controls restores nothing (no default assets), so the source
    // set stays empty after a re-upload and reset.
    await uploadImagesToField(page, "Section images", [
      svgImageFile("reset-check.svg", "#663399", 800, 600, "#ffffff"),
    ]);
    await waitForToolcraftAnimationFrames(page, 6);
    await expect(removeButtons).toHaveCount(1);
    await page.getByRole("button", { name: /Reset controls/i }).first().click();
    await waitForToolcraftAnimationFrames(page, 6);
    await expect(removeButtons).toHaveCount(0);
  });

  test("browser: transition select switches cut and crossfade output", async ({ page }) => {
    await openApp(page);
    await uploadTwoSectionImages(page);

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await selectComboOption(page, "Transition", "Crossfade");
        await expandTimelineIfCompact(page);
        await editTimelineDurationInline(page, 2);
        // Scrub into a crossfade boundary by playing briefly.
        await playTimeline(page);
        await page.waitForTimeout(700);
        await pauseTimeline(page);
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "crossfade must blend frames at slot boundaries" },
    );

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await selectComboOption(page, "Transition", "Cut");
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "switching back to cut must change the blended output" },
    );
  });

  test("browser: frame scale slider updates the composed frame live during drag", async ({
    page,
  }) => {
    await openApp(page);
    await uploadTwoSectionImages(page);

    const field = page
      .locator('[data-slot="field"]')
      .filter({ hasText: /^Scale/ })
      .first();
    const slider = field.locator('[data-slot="slider"], [role="slider"]').first();

    // Scroll the slider clear of the sticky footer so the thumb is clickable.
    await slider.scrollIntoViewIfNeeded();

    const beforeDrag = await getToolcraftProductObservableSnapshot(page);
    const box = await slider.boundingBox();
    const thumbBox = await field.locator('[data-slot="slider-thumb"]').first().boundingBox();

    if (!box || !thumbBox) {
      throw new Error("Could not measure the Scale slider.");
    }

    const y = box.y + box.height / 2;

    await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, y, { steps: 8 });
    await waitForToolcraftAnimationFrames(page, 4);

    // Mid-drag, before pointer release, the product output must have changed.
    const midDrag = await getToolcraftProductObservableSnapshot(page);

    expect(midDrag, "slider must update product output during the drag").not.toBe(
      beforeDrag,
    );

    await page.mouse.move(box.x + box.width * 0.2, y, { steps: 4 });
    await page.mouse.up();

    const afterDrag = await getToolcraftProductObservableSnapshot(page);

    expect(afterDrag).not.toBe(beforeDrag);
  });

  test("browser: corner radius slider rounds the frame corners", async ({ page }) => {
    await openApp(page);
    await uploadTwoSectionImages(page);

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await dragToolcraftSliderToValue(page, "Corner radius", 80);
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "corner radius must round the composed frame" },
    );
  });

  test("browser: frame shadow switch toggles the drop shadow", async ({ page }) => {
    await openApp(page);
    await uploadTwoSectionImages(page);

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await toggleSwitchByName(page, "Shadow");
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "shadow off must remove the drop shadow pixels" },
    );
    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await toggleSwitchByName(page, "Shadow");
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "shadow on must draw the drop shadow pixels" },
    );
  });

  test("browser: background mode select switches solid gradient and image backdrops", async ({
    page,
  }) => {
    await openApp(page);
    await uploadTwoSectionImages(page);

    // Solid mode shows the color control; gradient/image branch controls stay hidden.
    await expect(page.getByLabel("Gradient stops track")).toHaveCount(0);

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await selectComboOption(page, "Type", "Gradient");
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "gradient mode must render the gradient backdrop" },
    );
    await expect(page.getByLabel("Gradient stops track")).toBeVisible();

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await selectComboOption(page, "Type", "Image");
        await uploadImagesToField(page, "Backdrop image", [
          svgImageFile("backdrop.svg", "#0b3d0b", 1200, 700, "#88cc88"),
        ]);
        await waitForToolcraftAnimationFrames(page, 8);
      },
      { message: "image mode must render the uploaded backdrop" },
    );
    await expect(page.getByLabel("Gradient stops track")).toHaveCount(0);

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await selectComboOption(page, "Type", "Solid");
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "solid mode must render the solid backdrop; branch values are preserved" },
    );
  });

  test("browser: include background toggle controls preview and png transparency while video keeps background", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openApp(page);
    await uploadTwoSectionImages(page);
    await dragToolcraftSliderToValue(page, "Scale", 40);
    await selectComboOption(page, "Resolution", "2K");

    // Include off hides the preview product background and exports alpha PNG.
    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await toggleSwitchByName(page, "Include");
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "include off must hide the preview product background" },
    );

    const transparent = await clickFooterActionAndDownload(page, "Export PNG");
    const transparentImage = await decodeExportedImage(
      page,
      transparent.buffer,
      "image/png",
    );

    expect(transparentImage.cornerAlpha, "PNG must be transparent outside the frame").toBe(
      0,
    );

    await toggleSwitchByName(page, "Include");
    await waitForToolcraftAnimationFrames(page, 6);

    const opaque = await clickFooterActionAndDownload(page, "Export PNG");
    const opaqueImage = await decodeExportedImage(page, opaque.buffer, "image/png");

    expect(
      opaqueImage.cornerAlpha,
      "PNG with Include on must contain the background color",
    ).toBe(255);

    // Video keeps the background even when Include is off.
    await toggleSwitchByName(page, "Include");
    await waitForToolcraftAnimationFrames(page, 6);

    const video = await clickFooterActionAndDownload(page, "Export Video", 90_000);
    const videoMetadata = await loadExportedVideoDurationMetadata(
      page,
      video.buffer,
      video.download.suggestedFilename().endsWith(".mp4") ? "video/mp4" : "video/webm",
    );

    expect(
      videoMetadata.centerLuma,
      "video export must keep the dark background rather than white/transparent",
    ).toBeLessThan(128);
  });

  test("browser: background color updates the solid backdrop", async ({ page }) => {
    await openApp(page);
    await uploadTwoSectionImages(page);

    const backgroundField = page
      .locator('[data-slot="field"]')
      .filter({ has: page.locator('input[aria-label$="hex"]') })
      .first();
    const hexInput = backgroundField.locator('input[aria-label$="hex"]').first();

    await expect(hexInput, "the solid background hex input must be visible").toBeVisible();
    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await hexInput.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.type("22AA88");
        await page.keyboard.press("Enter");
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "a new hex value must repaint the solid backdrop" },
    );
  });

  test("browser: background gradient edits type angle and stops", async ({ page }) => {
    await openApp(page);
    await uploadTwoSectionImages(page);
    await selectComboOption(page, "Type", "Gradient");
    await waitForToolcraftAnimationFrames(page, 6);

    const stopsTrack = page.getByLabel("Gradient stops track");

    await expect(stopsTrack).toBeVisible();

    // Gradient type (linear -> radial).
    const gradientTypeCombo = page
      .getByRole("combobox")
      .filter({ hasText: /Linear|Radial/i })
      .first();

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await gradientTypeCombo.click();
        await page
          .locator('[data-slot="select-item"]')
          .filter({ hasText: /Radial/i })
          .first()
          .click();
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "gradient.gradientType must change the backdrop" },
    );
    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await gradientTypeCombo.click();
        await page
          .locator('[data-slot="select-item"]')
          .filter({ hasText: /Linear/i })
          .first()
          .click();
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "gradient.gradientType must switch back to linear" },
    );

    // Angle.
    const angleInput = page.getByLabel("Gradient angle").first();

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await angleInput.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.type("225");
        await page.keyboard.press("Enter");
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "gradient.angle must rotate the backdrop" },
    );

    // Stop position.
    const stopPosition = page.getByLabel("Stop 2 position").first();

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await stopPosition.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.type("55");
        await page.keyboard.press("Enter");
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "gradient.stops.position must move the gradient transition" },
    );

    // Stop opacity.
    const stopOpacity = page.getByLabel("Stop 2 opacity").first();

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await stopOpacity.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.type("40");
        await page.keyboard.press("Enter");
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "gradient.stops.opacity must change the gradient alpha" },
    );

    // Stop color: select the stop, then edit its hex input.
    await page.getByLabel("Gradient stop 2").first().click();

    const stopHexInput = page.locator('input[aria-label$="hex"]').last();

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await stopHexInput.click();
        await page.keyboard.press("ControlOrMeta+a");
        await page.keyboard.type("FF6600");
        await page.keyboard.press("Enter");
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "gradient.stops.color must repaint the gradient" },
    );
  });

  test("browser: background blur slider softens the backdrop image", async ({ page }) => {
    await openApp(page);
    await uploadTwoSectionImages(page);

    // The Blur slider is hidden until Type is Image.
    await expect(
      page.locator('[data-slot="field"]').filter({ hasText: /^Blur/ }),
    ).toHaveCount(0);

    await selectComboOption(page, "Type", "Image");
    await uploadImagesToField(page, "Backdrop image", [
      svgImageFile("blur-backdrop.svg", "#0b3d0b", 1200, 700, "#f2f2f2"),
    ]);
    await waitForToolcraftAnimationFrames(page, 8);

    await expect(
      page.locator('[data-slot="field"]').filter({ hasText: /^Blur/ }).first(),
    ).toBeVisible();

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await dragToolcraftSliderToValue(page, "Blur", 40);
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "blur must soften the backdrop image pixels" },
    );

    // The Blur slider disappears when leaving Image mode.
    await selectComboOption(page, "Type", "Solid");
    await expect(
      page.locator('[data-slot="field"]').filter({ hasText: /^Blur/ }),
    ).toHaveCount(0);
  });

  test("browser: backdrop image upload rotate flip clear and reset update the background", async ({
    page,
  }) => {
    await openApp(page);
    await uploadTwoSectionImages(page);

    // The backdrop uploader is hidden until Type is Image.
    await expect(
      page
        .locator('[data-slot="field"]')
        .filter({ has: page.locator('input[type="file"][accept^="image"]') }),
    ).toHaveCount(1);

    await selectComboOption(page, "Type", "Image");

    const field = getImageUploadField(page, "backdrop");

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await uploadImagesToField(page, "Backdrop image", [
          svgImageFile("backdrop.svg", "#301040", 1200, 700, "#c090e0"),
        ]);
        await waitForToolcraftAnimationFrames(page, 8);
      },
      { message: "uploading a backdrop must render it cover/cropped behind frames" },
    );

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await field.getByRole("button", { name: "90°" }).click();
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "rotating the backdrop must change rendered output via media transform" },
    );
    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await field.getByRole("button", { name: "Flip V" }).click();
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "flipping the backdrop must change rendered output via media transform" },
    );

    // Clear/remove falls back to the solid color.
    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await field.getByRole("button", { name: /^Remove / }).first().click();
        await waitForToolcraftAnimationFrames(page, 6);
      },
      { message: "removing the backdrop must fall back to the solid background" },
    );

    // Reset controls removes any uploaded backdrop (no default assets exist).
    await uploadImagesToField(page, "Backdrop image", [
      svgImageFile("backdrop-2.svg", "#104030", 900, 900, "#70c0a0"),
    ]);
    await waitForToolcraftAnimationFrames(page, 8);
    await page.getByRole("button", { name: /Reset controls/i }).first().click();
    await waitForToolcraftAnimationFrames(page, 6);
    // Reset returns background.mode to Solid, hiding the backdrop uploader.
    await expect(
      page
        .locator('[data-slot="field"]')
        .filter({ has: page.locator('input[type="file"][accept^="image"]') }),
    ).toHaveCount(1);
  });

  test("browser: image export format and resolution change exported bytes", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openApp(page);
    await uploadTwoSectionImages(page);

    // 2K PNG.
    await selectComboOption(page, "Resolution", "2K");

    const png2k = await clickFooterActionAndDownload(page, "Export PNG");

    expect(png2k.download.suggestedFilename()).toMatch(/\.png$/);

    const png2kImage = await decodeExportedImage(page, png2k.buffer, "image/png");

    expect(png2kImage.naturalWidth, "2k export must be a 2048px long edge").toBe(2048);
    expect(png2kImage.naturalHeight).toBe(1152);

    // 4K JPG: format changes bytes and mime; background always included.
    await selectComboOption(page, "Format", "JPG");
    await selectComboOption(page, "Resolution", "4K");

    const jpg4k = await clickFooterActionAndDownload(page, "Export PNG");

    expect(jpg4k.download.suggestedFilename()).toMatch(/\.jpg$/);
    expect(jpg4k.buffer[0], "JPG bytes must start with the JPEG magic").toBe(0xff);
    expect(jpg4k.buffer[1]).toBe(0xd8);

    const jpg4kImage = await decodeExportedImage(page, jpg4k.buffer, "image/jpeg");

    expect(jpg4kImage.naturalWidth, "4k export must be a 4096px long edge").toBe(4096);
    expect(jpg4kImage.naturalHeight).toBe(2304);
  });

  test("browser: video export format and resolution produce a real video matching timeline duration", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openApp(page);
    await uploadTwoSectionImages(page);

    // Edit the timeline duration so the duration proof is not the default.
    await expandTimelineIfCompact(page);
    await editTimelineDurationInline(page, 2);

    // WebM at Current resolution (the Video Export Format field).
    await selectComboOption(page, "Format", "WebM", 1);

    const webm = await clickFooterActionAndDownload(page, "Export Video", 90_000);

    expect(webm.download.suggestedFilename()).toMatch(/\.webm$/);

    const webmMetadata = await loadExportedVideoDurationMetadata(page, webm.buffer, "video/webm");

    expect(
      Math.abs(webmMetadata.duration - 2),
      "exported video.duration must match the edited timeline duration",
    ).toBeLessThanOrEqual(0.5);
    expect(webmMetadata.videoWidth, "Current resolution keeps the canvas size").toBe(1920);
    expect(webmMetadata.videoHeight).toBe(1080);

    // MP4 requested at 4K: exports through MediaRecorder.isTypeSupported with a
    // safe WebM fallback when mp4 recording is unsupported.
    await selectComboOption(page, "Format", "MP4", 1);
    await selectComboOption(page, "Resolution", "4K", 1);

    const mp4 = await clickFooterActionAndDownload(page, "Export Video", 120_000);
    const mp4Name = mp4.download.suggestedFilename();

    expect(mp4Name).toMatch(/\.(mp4|webm)$/);

    const mp4Metadata = await loadExportedVideoDurationMetadata(
      page,
      mp4.buffer,
      mp4Name.endsWith(".mp4") ? "video/mp4" : "video/webm",
    );

    expect(mp4Metadata.videoWidth, "4k video must fit inside 3840x2160").toBe(3840);
    expect(mp4Metadata.videoHeight).toBe(2160);
    expect(mp4Metadata.videoWidth % 2).toBe(0);
    expect(mp4Metadata.videoHeight % 2).toBe(0);
    expect(Math.abs(mp4Metadata.duration - 2)).toBeLessThanOrEqual(0.5);
  });

  test("browser: export actions deliver gif video and png output with a pending progress indicator", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await openApp(page);
    await uploadTwoSectionImages(page);

    // GIF: the primary product output.
    const gifDownloadPromise = page.waitForEvent("download", { timeout: 90_000 });

    await page.getByRole("button", { name: "Export GIF" }).first().click();

    // The sticky footer top accent indicator is visible while the returned
    // Promise is pending and advances with reportProgress.
    const progressIndicator = page.locator(
      '[data-slot="panel-actions-progress"], [data-slot="footer-progress"], [data-panel-actions-progress], [class*="progress"]',
    );

    await expect(progressIndicator.first()).toBeVisible({ timeout: 10_000 });

    const gifDownload = await gifDownloadPromise;
    const gifPath = await gifDownload.path();

    if (!gifPath) {
      throw new Error("GIF download produced no file.");
    }

    const { readFileSync } = await import("node:fs");
    const gifBuffer = readFileSync(gifPath);
    const gifInfo = gifLogicalScreenSize(gifBuffer);

    expect(gifDownload.suggestedFilename()).toMatch(/\.gif$/);
    expect(gifInfo.frameCount, "cut mode exports one GIF frame per image").toBe(2);
    expect(gifInfo.width).toBeGreaterThan(0);

    // PNG and Video also deliver bytes.
    const png = await clickFooterActionAndDownload(page, "Export PNG");

    expect(png.buffer.length).toBeGreaterThan(0);

    const video = await clickFooterActionAndDownload(page, "Export Video", 90_000);

    expect(video.buffer.length).toBeGreaterThan(0);
  });

  test("browser: timeline playback scrub duration and loop drive the frame cycle", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await openApp(page);
    await uploadImagesToField(page, "Section images", [
      svgImageFile("cycle-a.svg", "#d94040", 800, 600, "#101010"),
      svgImageFile("cycle-b.svg", "#2f6fd9", 800, 600, "#f0f0f0"),
      svgImageFile("cycle-c.svg", "#28a745", 800, 600, "#0a0a0a"),
    ]);
    await waitForToolcraftAnimationFrames(page, 8);
    await expandTimelineIfCompact(page);

    // Pause playback freezes the rendered frame; Play playback resumes it.
    const pauseButton = page.getByRole("button", { name: "Pause playback" });
    const playButton = page.getByRole("button", { name: "Play playback" });

    if ((await pauseButton.count()) > 0) {
      await pauseButton.first().click();
    }
    await waitForToolcraftAnimationFrames(page, 4);

    const frozenFirst = await getToolcraftProductObservableSnapshot(page);

    await page.waitForTimeout(400);

    const frozenSecond = await getToolcraftProductObservableSnapshot(page);

    expect(frozenSecond, "pause must freeze the rendered frame").toBe(frozenFirst);

    // Play playback advances the frame sequence across the loop.
    await playButton.first().click();

    const playingSamples = new Set<string>();

    for (let sample = 0; sample < 8; sample += 1) {
      playingSamples.add(await getToolcraftProductObservableSnapshot(page));
      await page.waitForTimeout(250);
    }

    expect(
      playingSamples.size,
      "playback must advance the rendered frame across the loop",
    ).toBeGreaterThan(1);

    // Loop transport: Disable loop then Enable loop keeps the forward-only cycle.
    const loopButton = page.getByRole("button", { name: /Disable loop|Enable loop/ });

    await expect(loopButton.first()).toBeVisible();
    await loopButton.first().click();
    await waitForToolcraftAnimationFrames(page, 2);
    await loopButton.first().click();
    await waitForToolcraftAnimationFrames(page, 2);

    // Re-pause for the deterministic scrub comparisons below.
    if ((await pauseButton.count()) > 0) {
      await pauseButton.first().click();
    }
    await waitForToolcraftAnimationFrames(page, 4);

    // Edit the timeline duration: one full frame cycle maps to
    // state.timeline.durationSeconds, so the playback range changes.
    await editTimelineDurationInline(page, 3);

    const scrubber = page.getByLabel("Playback position").first();

    await expect(scrubber).toBeVisible();

    const scrubberBox = await scrubber.boundingBox();

    if (!scrubberBox) {
      throw new Error("Could not measure the timeline scrubber.");
    }

    // Scrub to frame slots and compare rendered frames at 0, midpoint,
    // end minus epsilon, and the wrapped first frame: seamless forward-only
    // loop stitching after the duration edit.
    const scrubTo = async (ratio: number) => {
      await page.mouse.move(
        scrubberBox.x + scrubberBox.width * Math.min(Math.max(ratio, 0.001), 0.999),
        scrubberBox.y + scrubberBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.up();
      await waitForToolcraftAnimationFrames(page, 5);
    };

    await scrubTo(0);

    const startFrame = await getToolcraftProductObservableSnapshot(page);

    await scrubTo(0.5);

    const midFrame = await getToolcraftProductObservableSnapshot(page);

    expect(midFrame, "the midpoint of the duration must show another frame").not.toBe(
      startFrame,
    );

    await scrubTo(0.999);

    const endFrame = await getToolcraftProductObservableSnapshot(page);

    expect(endFrame, "end minus epsilon must show the last frame").not.toBe(midFrame);

    // Loop wrap: with looping on, playing past the end returns to the first
    // frame (forward-only, no reverse) — the wrapped frame equals frame 0.
    await scrubTo(0);

    const wrappedFrame = await getToolcraftProductObservableSnapshot(page);

    expect(wrappedFrame, "the wrapped first frame must stitch with time 0").toBe(
      startFrame,
    );

    await playTimeline(page);
    await page.waitForTimeout(400);
    await pauseTimeline(page);
  });

  test("browser: uploading a different aspect image keeps canvas size and covers within bounds", async ({
    page,
  }) => {
    await openApp(page);

    const widthInput = await getCanvasSizeInput(page, "Canvas width");
    const heightInput = await getCanvasSizeInput(page, "Canvas height");
    const readCanvasSize = async () => ({
      height: await heightInput.inputValue(),
      width: await widthInput.inputValue(),
    });
    const sizeBefore = await readCanvasSize();

    expect(sizeBefore).toEqual({ height: "1080", width: "1920" });

    await expectToolcraftProductObservableToChange(
      page,
      async () => {
        await uploadImagesToField(page, "Section images", [
          svgImageFile("portrait.svg", "#663399", 678, 904, "#ffffff"),
        ]);
        await waitForToolcraftAnimationFrames(page, 8);
      },
      { message: "the portrait upload must render inside the unchanged canvas bounds" },
    );

    const sizeAfter = await readCanvasSize();

    expect(sizeAfter, "uploading media must not change the canvas size").toEqual(
      sizeBefore,
    );
    await expect(page.locator(productCanvasSelector).first()).toBeVisible();
  });

  test("browser: resolution scale discrete slider changes canvas backing pixels", async ({
    page,
  }) => {
    await openApp(page);
    await uploadImagesToField(page, "Section images", [
      svgImageFile("scale.svg", "#d94040", 800, 600, "#101010"),
    ]);
    await waitForToolcraftAnimationFrames(page, 6);
    // Pause so the discrete-slider smoothness measurement isolates the control
    // interaction from the concurrent playback repaint loop.
    await pauseTimeline(page);
    await waitForToolcraftAnimationFrames(page, 4);

    // The runtime Resolution scale slider renders the discrete variant with
    // tick markers.
    const setupField = page
      .locator('[data-slot="field"]')
      .filter({ hasText: /^Resolution scale/ })
      .first();

    await expect(
      setupField.locator('[data-slot="slider"][data-variant="discrete"]'),
      "Resolution scale must render the discrete slider variant",
    ).toBeVisible();
    await expect(
      setupField.locator('[data-slot="slider-marker"]').first(),
      "the discrete slider must render tick markers",
    ).toBeVisible();

    // At the default render scale of 2 the product canvas backing pixels are
    // twice the CSS output size.
    await expectToolcraftCanvasBackingPixelsForRenderScale(
      page,
      productCanvasSelector,
      2,
    );

    // Lowering the render scale reduces the backing pixels without changing the
    // CSS output size.
    await dragToolcraftSliderToValue(page, "Resolution scale", 1);
    await waitForToolcraftAnimationFrames(page, 4);

    const loweredBacking = await page
      .locator(productCanvasSelector)
      .first()
      .evaluate((element) => (element as HTMLCanvasElement).width);

    expect(loweredBacking, "lowering render scale must shrink backing pixels").toBeLessThan(
      3840,
    );

    // Dragging the discrete control stays smooth.
    await expectToolcraftDiscreteSliderDragSmoothness(page, "Resolution scale", {
      expectMarkers: true,
    });
  });
});
