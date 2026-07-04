import { defineToolcraft } from "@/toolcraft/runtime";

export const appSchema = defineToolcraft({
  canvas: {
    enabled: true,
    renderScale: true,
    sizing: { mode: "editable-output" },
    upload: true,
  },
  export: {
    png: {
      background: "include",
    },
  },
  panels: {
    controls: {
      sections: [
        {
          controls: {
            frameImages: {
              accept: "image/*",
              assetKind: "image",
              defaultValue: null,
              label: "Section images",
              multiple: true,
              performanceReason:
                "Uploading updates runtime media; decoded-image render cost is covered by the media-import performance scenario.",
              performanceRole: "responsiveness",
              target: "frames.images",
              type: "fileDrop",
            },
            frameTransition: {
              defaultValue: "cut",
              label: "Transition",
              options: [
                { label: "Cut", value: "cut" },
                { label: "Crossfade", value: "crossfade" },
              ],
              orderRole: "mode",
              performanceReason:
                "Crossfade draws two frames with alpha blending instead of one opaque frame.",
              performanceRole: "workload",
              target: "frames.transition",
              type: "select",
            },
          },
          title: "Frames",
        },
        {
          controls: {
            frameScale: {
              defaultValue: 70,
              label: "Scale",
              max: 100,
              min: 20,
              orderRole: "primary",
              performanceReason:
                "Scale changes the drawn frame area and shadow blur region per frame.",
              performanceRole: "workload",
              step: 1,
              target: "frame.scale",
              type: "slider",
              unit: "%",
            },
            frameCornerRadius: {
              defaultValue: 16,
              label: "Corner radius",
              max: 80,
              min: 0,
              orderRole: "detail",
              performanceReason:
                "Corner radius adds a clip path per drawn frame and changes the shadow fill region.",
              performanceRole: "workload",
              step: 1,
              target: "frame.cornerRadius",
              type: "slider",
              unit: "px",
            },
            frameShadow: {
              defaultValue: true,
              label: "Shadow",
              orderRole: "detail",
              performanceReason:
                "Shadow enables canvas blur behind the frame; toggling changes composite cost.",
              performanceRole: "workload",
              target: "frame.shadow",
              type: "switch",
            },
          },
          title: "Frame Style",
        },
        {
          controls: {
            backgroundMode: {
              defaultValue: "solid",
              label: "Type",
              options: [
                { label: "Solid", value: "solid" },
                { label: "Gradient", value: "gradient" },
                { label: "Image", value: "image" },
              ],
              orderRole: "mode",
              performanceReason:
                "Background mode switches between fill, gradient fill, and image cover draw paths.",
              performanceRole: "workload",
              target: "background.mode",
              type: "select",
            },
            includeBackground: {
              defaultValue: true,
              label: "Include",
              performanceReason:
                "Include toggles the background layer in preview and PNG export alpha.",
              performanceRole: "responsiveness",
              target: "export.includeBackground",
              type: "switch",
            },
            backgroundColor: {
              defaultValue: { hex: "#111113" },
              label: false,
              performanceReason:
                "Background color changes a single fill; cost is constant.",
              performanceRole: "responsiveness",
              target: "background.color",
              type: "color",
              visibleWhen: { equals: "solid", target: "background.mode" },
            },
            backgroundGradient: {
              defaultValue: {
                angle: 135,
                gradientType: "linear",
                stops: [
                  { color: "#1B1B78", opacity: 100, position: 0 },
                  { color: "#8B2FBF", opacity: 100, position: 100 },
                ],
              },
              label: false,
              performanceReason:
                "Gradient stops rebuild one CanvasGradient per draw; cost stays constant per frame.",
              performanceRole: "responsiveness",
              target: "background.gradient",
              type: "gradient",
              visibleWhen: { equals: "gradient", target: "background.mode" },
            },
            backgroundImage: {
              accept: "image/*",
              assetKind: "image",
              defaultValue: null,
              label: "Backdrop image",
              orderRole: "color",
              performanceReason:
                "Uploading updates runtime media; decoded backdrop render cost is covered by the media-import performance scenario.",
              performanceRole: "responsiveness",
              target: "background.image",
              type: "fileDrop",
              visibleWhen: { equals: "image", target: "background.mode" },
            },
            backgroundBlur: {
              defaultValue: 0,
              label: "Blur",
              max: 40,
              min: 0,
              orderRole: "detail",
              performanceReason:
                "Canvas blur filter cost scales with the blur radius over the full backdrop area.",
              performanceRole: "workload",
              step: 1,
              target: "background.blur",
              type: "slider",
              unit: "px",
              visibleWhen: { equals: "image", target: "background.mode" },
            },
          },
          layoutGroups: [
            {
              columns: 2,
              controls: ["includeBackground", "backgroundColor"],
              layout: "inline",
            },
          ],
          title: "Background",
        },
        {
          controls: {
            imageFormat: {
              defaultValue: "png",
              label: "Format",
              options: [
                { label: "PNG", value: "png" },
                { label: "JPG", value: "jpg" },
              ],
              performanceReason:
                "Image format changes only the export encode step, not preview rendering.",
              performanceRole: "responsiveness",
              target: "export.image.format",
              type: "select",
            },
            imageResolution: {
              defaultValue: "4k",
              label: "Resolution",
              options: [
                { label: "2K", value: "2k" },
                { label: "4K", value: "4k" },
                { label: "8K", value: "8k" },
              ],
              performanceReason:
                "Export resolution multiplies exported pixel count; preview cost is unchanged.",
              performanceRole: "workload",
              target: "export.image.resolution",
              type: "select",
            },
          },
          layoutGroups: [
            {
              columns: 2,
              controls: ["imageFormat", "imageResolution"],
              layout: "inline",
            },
          ],
          title: "Image Export",
        },
        {
          controls: {
            videoFormat: {
              defaultValue: "mp4",
              label: "Format",
              options: [
                { label: "MP4", value: "mp4" },
                { label: "WebM", value: "webm" },
              ],
              performanceReason:
                "Video format selects the MediaRecorder container; preview cost is unchanged.",
              performanceRole: "responsiveness",
              target: "export.video.format",
              type: "select",
            },
            videoResolution: {
              defaultValue: "current",
              label: "Resolution",
              options: [
                { label: "Current", value: "current" },
                { label: "4K", value: "4k" },
              ],
              performanceReason:
                "Video resolution multiplies encoded pixel count during export only.",
              performanceRole: "workload",
              target: "export.video.resolution",
              type: "select",
            },
          },
          layoutGroups: [
            {
              columns: 2,
              controls: ["videoFormat", "videoResolution"],
              layout: "inline",
            },
          ],
          title: "Video Export",
        },
        {
          controls: {
            exportActions: {
              actions: [
                {
                  icon: "upload-simple",
                  label: "Export Video",
                  value: "export-video",
                  variant: "outline",
                },
                {
                  icon: "upload-simple",
                  label: "Export PNG",
                  value: "export-png",
                  variant: "outline",
                },
                { icon: "upload-simple", label: "Export GIF", value: "export-gif" },
              ],
              target: "export.actions",
              type: "panelActions",
            },
          },
          title: "Export",
        },
      ],
      title: "Layered GIF Creator",
    },
    timeline: {
      defaultDurationSeconds: 1.5,
      mode: "playback",
    },
  },
  settingsTransfer: "auto",
  toolbar: {
    history: true,
    radar: true,
    theme: true,
    zoom: true,
  },
});
