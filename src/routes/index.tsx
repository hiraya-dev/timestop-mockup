import { ToolcraftApp } from "@/toolcraft/runtime/react";

import { appSchema } from "../app/app-schema";
import { exportSceneGif } from "../app/export-gif";
import { exportSceneImage } from "../app/export-image";
import { exportSceneVideo } from "../app/export-video";
import { ProductRenderer } from "../app/product-renderer";

export function AppHome(): React.JSX.Element {
  return (
    <ToolcraftApp
      canvasContent={<ProductRenderer />}
      className="h-dvh min-h-dvh"
      onPanelAction={({ action, reportProgress, state }) => {
        if (action.value === "export-png") {
          return exportSceneImage({ reportProgress, state });
        }

        if (action.value === "export-video") {
          return exportSceneVideo({ reportProgress, state });
        }

        if (action.value === "export-gif") {
          return exportSceneGif({ reportProgress, state });
        }

        return undefined;
      }}
      renderDefaultCanvasMedia={false}
      schema={appSchema}
    />
  );
}
