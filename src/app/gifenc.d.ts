declare module "gifenc" {
  export type GifPalette = number[][];

  export type GifWriteFrameOptions = {
    delay?: number;
    dispose?: number;
    first?: boolean;
    palette?: GifPalette;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
  };

  export type GifEncoderInstance = {
    bytes: () => Uint8Array;
    bytesView: () => Uint8Array;
    finish: () => void;
    reset: () => void;
    writeFrame: (
      index: Uint8Array,
      width: number,
      height: number,
      options?: GifWriteFrameOptions,
    ) => void;
  };

  export function GIFEncoder(options?: { auto?: boolean }): GifEncoderInstance;
  export function quantize(
    data: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: Record<string, unknown>,
  ): GifPalette;
  export function applyPalette(
    data: Uint8Array | Uint8ClampedArray,
    palette: GifPalette,
    format?: string,
  ): Uint8Array;
  export function nearestColorIndex(
    colors: GifPalette,
    pixel: number[],
    distanceFn?: (a: number[], b: number[]) => number,
  ): number;
}
