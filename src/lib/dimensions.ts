import type { ThingObject } from "../types/editor";

export interface ObjectPixelDimensions {
  tileWidth: number;
  tileHeight: number;
  pixelWidth: number;
  pixelHeight: number;
  layers: number;
  patterns: number;
  frames: number;
}

export function objectDimensions(
  object: ThingObject,
  spriteSize: number,
  groupIndex = 0,
): ObjectPixelDimensions {
  const group = object.frameGroups[groupIndex] ?? object.frameGroups[0];
  const layout = group?.layout;
  const width = layout?.width || object.dimensions.width;
  const height = layout?.height || object.dimensions.height;
  const layers = layout?.layers || object.dimensions.layers;
  const patterns = layout
    ? layout.patternX * layout.patternY * layout.patternZ
    : object.dimensions.patterns;
  return {
    tileWidth: width,
    tileHeight: height,
    pixelWidth: width * spriteSize,
    pixelHeight: height * spriteSize,
    layers,
    patterns,
    frames: group?.frames.length ?? 0,
  };
}
