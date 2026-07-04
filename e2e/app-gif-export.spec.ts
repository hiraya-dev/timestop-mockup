import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import {
  clickFooterActionAndDownload,
  gifLogicalScreenSize,
  openApp,
  uploadImagesToField,
  type UploadFile,
} from "./app-helpers";
import { waitForToolcraftAnimationFrames } from "./performance-helpers";

// Top half white, bottom half black — an unambiguous vertical orientation marker.
function halfSplitImage(): UploadFile {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">' +
    '<rect width="800" height="300" fill="#ffffff"/>' +
    '<rect y="300" width="800" height="300" fill="#000000"/></svg>';

  return { buffer: Buffer.from(svg, "utf8"), mimeType: "image/svg+xml", name: "half.svg" };
}

test("browser: exported gif is upright and rendered at export resolution", async ({
  page,
}) => {
  await openApp(page);
  await uploadImagesToField(page, "Section images", [halfSplitImage()]);
  await waitForToolcraftAnimationFrames(page, 8);

  const { download } = await clickFooterActionAndDownload(page, "Export GIF", 60_000);
  const gifPath = await download.path();

  if (!gifPath) {
    throw new Error("GIF export produced no file.");
  }

  const gifBuffer = readFileSync(gifPath);
  const { height, width } = gifLogicalScreenSize(gifBuffer);

  // Quality: the GIF long edge is rendered well above a thumbnail resolution.
  expect(Math.max(width, height)).toBeGreaterThanOrEqual(1200);

  // Orientation: decode the first frame and compare the upper vs lower band of
  // the composed frame. The white half must be on top.
  const bands = await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const blob = new Blob([bytes], { type: "image/gif" });
    const url = URL.createObjectURL(blob);
    const image = new Image();

    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Failed to decode exported GIF."));
      image.src = url;
    });

    const canvas = document.createElement("canvas");

    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("No 2D context to sample the GIF.");
    }

    context.drawImage(image, 0, 0);
    URL.revokeObjectURL(url);

    const sampleLuma = (yFraction: number) => {
      const y = Math.round(canvas.height * yFraction);
      const data = context.getImageData(
        Math.round(canvas.width * 0.35),
        y,
        Math.round(canvas.width * 0.3),
        1,
      ).data;
      let sum = 0;

      for (let index = 0; index < data.length; index += 4) {
        sum += (data[index]! + data[index + 1]! + data[index + 2]!) / 3;
      }

      return sum / (data.length / 4);
    };

    return { bottom: sampleLuma(0.58), top: sampleLuma(0.42) };
  }, gifBuffer.toString("base64"));

  expect(
    bands.top,
    "the white top half of the source must stay on top in the exported GIF",
  ).toBeGreaterThan(bands.bottom + 60);
});
