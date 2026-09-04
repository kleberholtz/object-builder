import type { ThingObject } from "../types/editor";

export interface ObjectPixelDimensions { tileWidth: number; tileHeight: number; pixelWidth: number; pixelHeight: number; layers: number; patterns: number; frames: number }

export function objectDimensions(object: ThingObject, spriteSize: number): ObjectPixelDimensions {
  return {
    tileWidth: object.dimensions.width,
    tileHeight: object.dimensions.height,
    pixelWidth: object.dimensions.width * spriteSize,
    pixelHeight: object.dimensions.height * spriteSize,
    layers: object.dimensions.layers,
    patterns: object.dimensions.patterns,
    frames: object.frameGroups.reduce((total, group) => total + group.frames.length, 0),
  };
}
