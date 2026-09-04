export type ObjectKind = "Item" | "Outfit" | "Effect" | "Missile" | "Unknown";

export interface Frame {
  id: number;
  spriteId: number;
  duration: number;
}

export interface FrameGroup {
  id: string;
  name: string;
  loop: boolean;
  frames: Frame[];
  spriteIds: number[];
}

export interface ThingObject {
  id: number;
  name: string;
  kind: ObjectKind;
  spriteId: number;
  modified?: boolean;
  dimensions: { width: number; height: number; layers: number; patterns: number };
  position: { x: number; y: number; elevation: number };
  animation: { mode: "Asynchronous" | "Synchronous" | "Random"; loop: boolean };
  gameplay: { groundSpeed: number; lightLevel: number; lightColor: number; minimapColor: number };
  flags: Record<string, boolean>;
  attributes: Array<{ key: string; value: string }>;
  frameGroups: FrameGroup[];
}

export interface ProjectInfo {
  name: string;
  clientVersion: string;
  datFile: string;
  sprFile: string;
  objectCount: number;
  spriteCount: number;
  dirty: boolean;
  projectFile?: string | null;
  spriteSize: number;
}
