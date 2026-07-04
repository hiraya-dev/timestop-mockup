import { describe, expect, it } from "vitest";

import { getToolcraftControlOrderTargets } from "./app-acceptance";
import { appSchema } from "./app-schema";

describe("appSchema", () => {
  it("keeps the runtime Toolcraft shell with editable output sizing", () => {
    expect(appSchema.canvas.enabled).toBe(true);
    expect(appSchema.canvas.sizing).toEqual({ mode: "editable-output" });
    expect(appSchema.canvas.upload).toBe(true);
    expect(appSchema.canvas.renderScale.enabled).toBe(true);
    expect(appSchema.panels.controls?.sections[0]?.title).toBe("Setup");
    expect(appSchema.panels.controls?.sections[0]?.controls.settingsTransfer).toMatchObject({
      target: "runtime.settingsTransfer",
      type: "settingsTransfer",
    });
    expect(appSchema.panels.controls?.sections[0]?.controls.canvasWidth).toMatchObject({
      target: "canvas.size.width",
      type: "text",
    });
    expect(appSchema.toolbar).toEqual({
      history: true,
      radar: true,
      theme: true,
      zoom: true,
    });
  });

  it("enables the playback timeline with the reference loop duration", () => {
    expect(appSchema.panels.timeline).toMatchObject({
      defaultDurationSeconds: 1.5,
      mode: "playback",
    });
    expect(appSchema.assembly.capabilities).toContain("timeline.playback");
    expect(appSchema.panels.layers).toBeUndefined();
  });

  it("orders product controls by decision flow", () => {
    const targets = getToolcraftControlOrderTargets(appSchema);
    const productTargets = targets.filter(
      (target) =>
        !target.startsWith("canvas.") &&
        !target.startsWith("runtime.") &&
        !target.startsWith("panels."),
    );

    expect(productTargets).toEqual([
      "frames.images",
      "frames.transition",
      "frame.scale",
      "frame.cornerRadius",
      "frame.shadow",
      "background.mode",
      "export.includeBackground",
      "background.color",
      "background.gradient",
      "background.image",
      "background.blur",
      "export.image.format",
      "export.image.resolution",
      "export.video.format",
      "export.video.resolution",
    ]);
  });

  it("keeps branch controls gated by the background mode selector", () => {
    const backgroundSection = appSchema.panels.controls?.sections.find(
      (section) => section.title === "Background",
    );

    expect(backgroundSection?.controls.backgroundColor?.visibleWhen).toEqual({
      equals: "solid",
      target: "background.mode",
    });
    expect(backgroundSection?.controls.backgroundGradient?.visibleWhen).toEqual({
      equals: "gradient",
      target: "background.mode",
    });
    expect(backgroundSection?.controls.backgroundImage?.visibleWhen).toEqual({
      equals: "image",
      target: "background.mode",
    });
  });
});
