import { expect, test } from "@playwright/test";

import { getCanvasSizeInput, openApp, svgImageFile, uploadImagesToField } from "./app-helpers";

test("browser: product shell exposes setup controls and product sections", async ({
  page,
}) => {
  await openApp(page);

  await expect(page.getByRole("button", { name: "Export Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import Settings" })).toBeVisible();
  await expect(await getCanvasSizeInput(page, "Canvas width")).toBeVisible();
  await expect(await getCanvasSizeInput(page, "Canvas height")).toBeVisible();

  await expect(page.getByText("Section images", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Frame Style", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Background", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Image Export", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Video Export", { exact: true }).first()).toBeVisible();

  await expect(page.getByRole("button", { name: "Export GIF" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export Video" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export PNG" })).toBeVisible();
});

test("browser: canvas accepts section image uploads as product frames", async ({ page }) => {
  await openApp(page);

  await uploadImagesToField(page, "Section images", [
    svgImageFile("drop-fixture.svg", "#888888", 128, 96),
  ]);

  await expect(page.getByRole("img", { name: "drop-fixture.svg" })).toBeVisible();
  await expect(page.locator("[data-toolcraft-product-output]")).toBeVisible();
});
