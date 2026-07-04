import { readFileSync } from "node:fs";

import { expect, type Download, type Locator, type Page } from "@playwright/test";

export type UploadFile = {
  buffer: Buffer;
  mimeType: string;
  name: string;
};

export function svgImageFile(
  name: string,
  color: string,
  width = 800,
  height = 600,
  accent = "#ffffff",
): UploadFile {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${color}"/><rect x="${width * 0.1}" y="${height * 0.1}" width="${width * 0.4}" height="${height * 0.2}" fill="${accent}"/></svg>`;

  return {
    buffer: Buffer.from(svg, "utf8"),
    mimeType: "image/svg+xml",
    name,
  };
}

export async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('[data-slot="toolcraft-runtime-app"]')).toBeVisible();
  await expect(page.getByRole("application", { name: "Canvas viewport" })).toBeVisible();
}

export async function getFieldByLabel(page: Page, label: string): Promise<Locator> {
  const field = page
    .locator('[data-slot="field"]')
    .filter({ hasText: new RegExp(`^${label}`) })
    .first();

  await expect(field, `field "${label}" should be visible`).toBeVisible();

  return field;
}

export function getImageUploadField(page: Page, which: "backdrop" | "frames"): Locator {
  const fields = page
    .locator('[data-slot="field"]')
    .filter({ has: page.locator('input[type="file"][accept^="image"]') });

  // The Section images uploader renders before the Background section's
  // backdrop uploader in panel order.
  return which === "frames" ? fields.first() : fields.nth(1);
}

export async function uploadImagesToField(
  page: Page,
  label: string,
  files: UploadFile[],
): Promise<void> {
  const field = getImageUploadField(page, label === "Backdrop image" ? "backdrop" : "frames");
  const input = field.locator('input[type="file"]').first();

  await input.setInputFiles(files);
}

export async function getCanvasSizeInput(page: Page, label: string): Promise<Locator> {
  const field = await getFieldByLabel(page, label);

  return field.getByRole("textbox").first();
}

/**
 * Drag one dnd-kit sortable thumbnail onto another. dnd-kit's PointerSensor
 * needs an activation offset plus incremental moves, so a plain dragTo does not
 * reorder; this simulates a real held drag.
 */
export async function dragThumbnail(from: Locator, to: Locator): Promise<void> {
  const page = from.page();
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();

  if (!fromBox || !toBox) {
    throw new Error("Could not measure thumbnails for reorder drag.");
  }

  const startX = fromBox.x + fromBox.width / 2;
  const startY = fromBox.y + fromBox.height / 2;
  const endX = toBox.x + toBox.width / 2;
  const endY = toBox.y + toBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Exceed the dnd-kit activation distance before travelling.
  await page.mouse.move(startX + 6, startY + 6);
  await page.waitForTimeout(50);

  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(
      startX + ((endX - startX) * step) / 8,
      startY + ((endY - startY) * step) / 8,
    );
    await page.waitForTimeout(25);
  }

  await page.mouse.move(endX, endY);
  await page.waitForTimeout(50);
  await page.mouse.up();
}

export async function selectComboOption(
  page: Page,
  fieldLabel: string,
  optionLabel: string,
  nth = 0,
): Promise<void> {
  // Toolcraft select fields expose the label as sibling text and name the
  // combobox by its current value, so locate the field group by label text.
  // Require the field to actually contain a combobox so labels like
  // "Resolution" do not collide with the "Resolution scale" slider in Setup.
  const field = page
    .locator('[data-slot="field"]')
    .filter({ hasText: new RegExp(`^${fieldLabel}`) })
    .filter({ has: page.getByRole("combobox") })
    .nth(nth);
  const combo = field.getByRole("combobox").first();

  await expect(combo, `select "${fieldLabel}" should be visible`).toBeVisible();

  // Base UI renders select options as [data-slot="select-item"]; the a11y
  // "option" role is unreliable here because the popup mounts a duplicate
  // positioner listbox, so match the item slot directly.
  const option = page
    .locator('[data-slot="select-item"]')
    .filter({ hasText: new RegExp(`^${optionLabel}$`) })
    .first();

  // The opening click occasionally does not register; open the popup, then
  // only retry the click if the item genuinely did not appear.
  await combo.click();

  try {
    await option.waitFor({ state: "visible", timeout: 1500 });
  } catch {
    await combo.click();
    await option.waitFor({ state: "visible", timeout: 3000 });
  }

  await option.click();
}

export async function toggleSwitchByName(page: Page, name: string): Promise<void> {
  // Toolcraft switches render the label as sibling text without an aria-label.
  const field = page
    .locator('[data-slot="field"]')
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByRole("switch") })
    .first();
  const control = field.getByRole("switch").first();

  await expect(control, `switch "${name}" should be visible`).toBeVisible();
  await control.click();
}

export async function clickFooterActionAndDownload(
  page: Page,
  actionName: string,
  timeoutMs = 60_000,
): Promise<{ buffer: Buffer; download: Download }> {
  const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs });

  await page.getByRole("button", { name: actionName }).first().click();

  const download = await downloadPromise;
  const filePath = await download.path();

  if (!filePath) {
    throw new Error(`Download for "${actionName}" produced no file.`);
  }

  return { buffer: readFileSync(filePath), download };
}

export async function decodeImageDimensionsInPage(
  page: Page,
  buffer: Buffer,
  mimeType: string,
): Promise<{ naturalHeight: number; naturalWidth: number }> {
  return page.evaluate(
    async ({ base64, mime }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: mime });
      const url = URL.createObjectURL(blob);
      const image = new Image();

      try {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error("Failed to decode exported image."));
          image.src = url;
        });

        return { naturalHeight: image.naturalHeight, naturalWidth: image.naturalWidth };
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    { base64: buffer.toString("base64"), mime: mimeType },
  );
}

export async function readImageCornerAlphaInPage(
  page: Page,
  buffer: Buffer,
  mimeType: string,
): Promise<number> {
  return page.evaluate(
    async ({ base64, mime }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: mime });
      const bitmap = await createImageBitmap(blob);
      const probe = document.createElement("canvas");

      probe.width = 4;
      probe.height = 4;

      const probeContext = probe.getContext("2d");

      if (!probeContext) {
        throw new Error("No probe context.");
      }

      probeContext.drawImage(bitmap, 0, 0);

      return probeContext.getImageData(0, 0, 1, 1).data[3] ?? 255;
    },
    { base64: buffer.toString("base64"), mime: mimeType },
  );
}

export async function loadVideoMetadataInPage(
  page: Page,
  buffer: Buffer,
  mimeType: string,
): Promise<{ duration: number; videoHeight: number; videoWidth: number }> {
  return page.evaluate(
    async ({ base64, mime }) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const blob = new Blob([bytes], { type: mime });
      const url = URL.createObjectURL(blob);
      const video = document.createElement("video");

      try {
        const metadata = await new Promise<{
          duration: number;
          videoHeight: number;
          videoWidth: number;
        }>((resolve, reject) => {
          const timeout = window.setTimeout(
            () => reject(new Error("Timed out waiting for exported video metadata.")),
            20_000,
          );

          video.addEventListener(
            "loadedmetadata",
            () => {
              const settle = () => {
                window.clearTimeout(timeout);
                resolve({
                  duration: video.duration,
                  videoHeight: video.videoHeight,
                  videoWidth: video.videoWidth,
                });
              };

              // WebM blobs from MediaRecorder can report Infinity until a seek.
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

        return metadata;
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    { base64: buffer.toString("base64"), mime: mimeType },
  );
}

export function gifLogicalScreenSize(buffer: Buffer): {
  frameCount: number;
  height: number;
  width: number;
} {
  const header = buffer.subarray(0, 6).toString("ascii");

  if (header !== "GIF89a" && header !== "GIF87a") {
    throw new Error(`Not a GIF file: ${header}`);
  }

  let frameCount = 0;

  // Count image descriptor separators (0x2C) at block boundaries: a full GIF
  // parser is unnecessary to prove multiple frames, so scan for graphic
  // control extensions (21 F9) which precede each rendered frame.
  for (let index = 0; index < buffer.length - 1; index += 1) {
    if (buffer[index] === 0x21 && buffer[index + 1] === 0xf9) {
      frameCount += 1;
    }
  }

  return {
    frameCount,
    height: buffer.readUInt16LE(8),
    width: buffer.readUInt16LE(6),
  };
}

export async function playTimeline(page: Page): Promise<void> {
  // Media-ready playback can already be running; only click Play when paused.
  const playButton = page.getByRole("button", { name: "Play playback" });

  if ((await playButton.count()) > 0) {
    await playButton.first().click();
  }
}

export async function pauseTimeline(page: Page): Promise<void> {
  const pauseButton = page.getByRole("button", { name: "Pause playback" });

  if ((await pauseButton.count()) > 0) {
    await pauseButton.first().click();
  }
}

export async function editTimelineDuration(page: Page, seconds: number): Promise<void> {
  await page.getByRole("button", { name: "Edit timeline duration" }).first().click();

  const durationBox = page.getByRole("textbox", { name: "timeline duration" }).first();

  await expect(durationBox).toBeVisible();
  await durationBox.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type(String(seconds));
  await page.keyboard.press("Enter");
}

export async function expandTimelineIfCompact(page: Page): Promise<void> {
  const timelineField = page
    .locator('[data-slot="field"]')
    .filter({ has: page.getByText("Timeline", { exact: true }) })
    .filter({ has: page.getByRole("switch") })
    .first();
  const timelineSwitch = timelineField.getByRole("switch").first();

  await expect(timelineSwitch, "Setup must expose the Timeline switch").toBeVisible();

  const checked =
    (await timelineSwitch.getAttribute("aria-checked")) ??
    (await timelineSwitch.getAttribute("data-checked")) ??
    "false";

  if (checked !== "true" && checked !== "") {
    await timelineSwitch.click();
  }

  await expect(
    page.getByRole("button", { name: "Edit timeline duration" }).first(),
  ).toBeVisible();
}
