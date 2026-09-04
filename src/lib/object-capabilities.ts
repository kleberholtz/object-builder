import type { ObjectKind } from "../types/editor";

export type EditableObjectKind = Exclude<ObjectKind, "Unknown">;

/**
 * DAT stores every category through the same attribute table, so nothing in the format stops an
 * outfit from carrying a minimap color. The client is what narrows it: ground speed is read from
 * the ground attribute of a tile item, elevation only stacks items, and market data reaches the
 * item shop alone. This table is that narrowing, so the Inspector offers each category the fields
 * its category actually uses — and the pattern axes under the names they carry there.
 */
export interface ObjectCapabilities {
  patternLabels: { x: string; y: string; z: string };
  elevation: boolean;
  minimapColor: boolean;
  groundSpeed: boolean;
  serverAttributes: boolean;
}

const genericPatterns = { x: "Pattern X", y: "Pattern Y", z: "Pattern Z" };

const capabilities: Record<EditableObjectKind, ObjectCapabilities> = {
  Item: {
    patternLabels: genericPatterns,
    elevation: true,
    minimapColor: true,
    groundSpeed: true,
    serverAttributes: true,
  },
  Outfit: {
    // patternX walks the four directions, patternY the addons and patternZ the mount.
    patternLabels: { x: "Directions", y: "Addons", z: "Mounts" },
    elevation: false,
    minimapColor: false,
    groundSpeed: false,
    serverAttributes: false,
  },
  Effect: {
    patternLabels: genericPatterns,
    elevation: false,
    minimapColor: false,
    groundSpeed: false,
    serverAttributes: false,
  },
  Missile: {
    // patternX and patternY are the 3x3 grid that gives a missile its eight directions.
    patternLabels: genericPatterns,
    elevation: false,
    minimapColor: false,
    groundSpeed: false,
    serverAttributes: false,
  },
};

export function objectCapabilities(kind: ObjectKind): ObjectCapabilities {
  return capabilities[kind as EditableObjectKind] ?? capabilities.Item;
}

/**
 * "Moveable" has no attribute of its own: the DAT reader derives it from the absence of
 * "Not moveable", and the writer drops it again. It is the one flag the Inspector keeps in sync
 * instead of offering.
 */
export const derivedFlag = "Moveable";

export type FlagGroupId = "stacking" | "movement" | "usage" | "appearance";

export const flagGroups: ReadonlyArray<{ id: FlagGroupId; title: string }> = [
  { id: "stacking", title: "Stacking order" },
  { id: "movement", title: "Movement & blocking" },
  { id: "usage", title: "Use & contents" },
  { id: "appearance", title: "Appearance & light" },
];

export interface FlagDefinition {
  /** Attribute id in the 8.60-9.86 layout, which is the one every other version normalizes to. */
  attribute: number;
  name: string;
  group: FlagGroupId;
  description: string;
  /** Categories whose client reads this attribute. */
  kinds: readonly EditableObjectKind[];
  /**
   * Client range for the attributes the reader remaps by hand. Outside it the raw byte means
   * something else, and the byte-level check below would still accept it.
   */
  versions?: { min?: number; max?: number };
}

const item: readonly EditableObjectKind[] = ["Item"];
const every: readonly EditableObjectKind[] = ["Item", "Outfit", "Effect", "Missile"];

/**
 * The complete attribute table the DAT reader and writer know, in the same order and under the
 * same names — a flag missing here would be unreachable in the Inspector, and one invented here
 * would fail serialization with "cannot encode unknown DAT flag".
 */
export const flagCatalog: readonly FlagDefinition[] = [
  {
    attribute: 0,
    name: "Ground",
    group: "stacking",
    description: "Tile ground; carries the walking speed edited under Lighting & Minimap.",
    kinds: item,
  },
  {
    attribute: 1,
    name: "Ground border",
    group: "stacking",
    description: "Drawn over the ground and under every other item on the tile.",
    kinds: item,
  },
  {
    attribute: 2,
    name: "Bottom",
    group: "stacking",
    description: "Stacks below creatures, such as a doormat or a stair.",
    kinds: item,
  },
  {
    attribute: 3,
    name: "Top",
    group: "stacking",
    description: "Stacks above creatures, such as a roof or a treetop.",
    kinds: item,
  },
  {
    attribute: 30,
    name: "Full ground",
    group: "stacking",
    description: "Covers the whole tile, so the ground under it is not drawn.",
    kinds: item,
  },
  {
    attribute: 12,
    name: "Not walkable",
    group: "movement",
    description: "Blocks creatures from stepping onto the tile.",
    kinds: item,
  },
  {
    attribute: 13,
    name: "Not moveable",
    group: "movement",
    description: "Cannot be pushed or dragged; clears the derived Moveable flag.",
    kinds: item,
  },
  {
    attribute: 14,
    name: "Block projectile",
    group: "movement",
    description: "Stops missiles from crossing the tile.",
    kinds: item,
  },
  {
    attribute: 15,
    name: "Block path",
    group: "movement",
    description: "Excluded from automatic pathfinding.",
    kinds: item,
  },
  {
    attribute: 16,
    name: "Pickupable",
    group: "movement",
    description: "Can be taken into a container or the inventory.",
    kinds: item,
  },
  {
    attribute: 17,
    name: "Hangable",
    group: "movement",
    description: "Can be hung on a wall.",
    kinds: item,
  },
  {
    attribute: 18,
    name: "Hook south",
    group: "movement",
    description: "Hangs on the southern wall of the tile.",
    kinds: item,
  },
  {
    attribute: 19,
    name: "Hook east",
    group: "movement",
    description: "Hangs on the eastern wall of the tile.",
    kinds: item,
  },
  {
    attribute: 20,
    name: "Rotatable",
    group: "movement",
    description: "Can be turned in place by the client.",
    kinds: item,
  },
  {
    attribute: 252,
    name: "Floor change",
    group: "movement",
    description: "Moves the player to another floor when stepped on.",
    kinds: item,
    versions: { min: 740, max: 779 },
  },
  {
    attribute: 4,
    name: "Container",
    group: "usage",
    description: "Opens as a container window.",
    kinds: item,
  },
  {
    attribute: 5,
    name: "Stackable",
    group: "usage",
    description: "Piles up to a count instead of taking one slot each.",
    kinds: item,
  },
  {
    attribute: 6,
    name: "Force use",
    group: "usage",
    description: "Left click uses the object instead of walking to it.",
    kinds: item,
  },
  {
    attribute: 7,
    name: "Multi use",
    group: "usage",
    description: "Use asks for a second target.",
    kinds: item,
  },
  {
    attribute: 8,
    name: "Writable",
    group: "usage",
    description: "Text can be written and rewritten; carries the maximum length.",
    kinds: item,
  },
  {
    attribute: 9,
    name: "Writable once",
    group: "usage",
    description: "Text can be written a single time; carries the maximum length.",
    kinds: item,
  },
  {
    attribute: 10,
    name: "Fluid container",
    group: "usage",
    description: "Holds a fluid, drawn by the fluid's pattern.",
    kinds: item,
  },
  {
    attribute: 11,
    name: "Splash",
    group: "usage",
    description: "A puddle on the ground, drawn by the fluid's pattern.",
    kinds: item,
  },
  {
    attribute: 34,
    name: "Usable",
    group: "usage",
    description: "Offers Use in the context menu; carries the client action id.",
    kinds: item,
  },
  {
    attribute: 32,
    name: "Cloth",
    group: "usage",
    description: "Equipment; carries the inventory slot it occupies.",
    kinds: item,
  },
  {
    attribute: 33,
    name: "Market",
    group: "usage",
    description: "Tradable on the market; carries the entry edited on the Server tab.",
    kinds: item,
  },
  {
    attribute: 35,
    name: "Wrappable",
    group: "usage",
    description: "Can be wrapped into a parcel by house decoration.",
    kinds: item,
  },
  {
    attribute: 36,
    name: "Unwrappable",
    group: "usage",
    description: "Is a wrapped object that can be unwrapped again.",
    kinds: item,
  },
  {
    attribute: 254,
    name: "Chargeable",
    group: "usage",
    description: "Shows remaining charges instead of a count.",
    kinds: item,
    versions: { min: 780, max: 859 },
  },
  {
    attribute: 29,
    name: "Lens help",
    group: "usage",
    description: "Shows a help cursor; carries the help id.",
    kinds: item,
  },
  {
    attribute: 21,
    name: "Light",
    group: "appearance",
    description: "Emits light; carries the level and color edited under Lighting & Minimap.",
    kinds: every,
  },
  {
    attribute: 24,
    name: "Displacement",
    group: "appearance",
    description: "Drawn off the tile; carries the X and Y offsets edited under Position.",
    kinds: every,
  },
  {
    attribute: 25,
    name: "Elevation",
    group: "appearance",
    description: "Lifts what is stacked on top; carries the height edited under Position.",
    kinds: item,
  },
  {
    attribute: 28,
    name: "Minimap color",
    group: "appearance",
    description: "Paints the tile on the minimap; carries the color index.",
    kinds: item,
  },
  {
    attribute: 22,
    name: "Don't hide",
    group: "appearance",
    description: "Stays visible under an object that would otherwise cover it.",
    kinds: item,
  },
  {
    attribute: 23,
    name: "Translucent",
    group: "appearance",
    description: "Drawn semi-transparent when the player stands behind it.",
    kinds: item,
  },
  {
    attribute: 26,
    name: "Lying corpse",
    group: "appearance",
    description: "Drawn flat on the ground, like a corpse.",
    kinds: item,
  },
  {
    attribute: 31,
    name: "Ignore look",
    group: "appearance",
    description: "Look targets what is under it instead of the object itself.",
    kinds: item,
  },
  {
    attribute: 27,
    name: "Animate always",
    group: "appearance",
    description: "Animates even while off screen or not moving.",
    kinds: ["Item", "Effect"],
  },
  {
    attribute: 253,
    name: "No move animation",
    group: "appearance",
    description: "Keeps the idle frame while the creature carrying it moves.",
    kinds: item,
    versions: { min: 1000 },
  },
  {
    attribute: 37,
    name: "Top effect",
    group: "appearance",
    description: "Drawn above everything else on the tile.",
    kinds: ["Effect"],
  },
];

const byName = new Map(flagCatalog.map((definition) => [definition.name, definition]));

export function flagDefinition(name: string): FlagDefinition | undefined {
  return byName.get(name);
}

/**
 * Mirrors `normalize_attribute` in the DAT reader. It has to stay identical: what the Inspector
 * offers is exactly what the writer can put back on disk for that client.
 */
function normalizeAttribute(raw: number, version: number): number {
  let attribute = raw;
  if (version >= 1000) {
    if (attribute === 16) return 253;
    if (attribute > 16) attribute -= 1;
  } else if (version >= 860) {
    // 8.60-9.86 is the canonical attribute layout.
  } else if (version >= 780) {
    if (attribute === 8) return 254;
    if (attribute > 8) attribute -= 1;
  } else if (version >= 755) {
    if (attribute === 23) return 252;
  } else if (version >= 740) {
    const remapped: Record<number, number> = {
      16: 21,
      17: 252,
      18: 30,
      19: 25,
      20: 24,
      22: 28,
      23: 20,
      24: 26,
      25: 17,
      26: 18,
      27: 19,
      28: 27,
    };
    attribute =
      attribute >= 1 && attribute <= 15 ? attribute + 1 : (remapped[attribute] ?? attribute);
    if (attribute === 7) return 6;
    if (attribute === 6) return 7;
  }
  return attribute;
}

/** Mirrors `denormalize_attribute`: a version encodes an attribute only if some raw byte reaches it. */
function encodableAttribute(attribute: number, version: number): boolean {
  for (let raw = 0; raw <= 254; raw += 1)
    if (normalizeAttribute(raw, version) === attribute) return true;
  return false;
}

/** The client version arrives as the label the backend prints ("10.98"), not as a number. */
export function clientVersionNumber(label: string | undefined | null): number {
  if (!label) return 1098;
  const [major, minor] = label.split(".");
  if (minor === undefined) {
    const numeric = Number(major);
    return Number.isFinite(numeric) && numeric >= 100 ? numeric : 1098;
  }
  const numeric = Number(major) * 100 + Number(minor);
  return Number.isFinite(numeric) && numeric >= 100 ? numeric : 1098;
}

export type FlagSupport = "available" | "unused" | "unversioned" | "unknown";

/**
 * Why a flag is or is not offered for one object: its category may not read it, or the project's
 * client may have no byte for it — a flag in that state would fail the DAT write, not be ignored.
 */
export function flagSupport(kind: ObjectKind, name: string, version: number): FlagSupport {
  const definition = byName.get(name);
  if (!definition) return "unknown";
  if (!definition.kinds.includes(kind as EditableObjectKind)) return "unused";
  if (version < (definition.versions?.min ?? 0) || version > (definition.versions?.max ?? 65535))
    return "unversioned";
  return encodableAttribute(definition.attribute, version) ? "available" : "unversioned";
}

export function flagAppliesTo(kind: ObjectKind, name: string) {
  return byName.get(name)?.kinds.includes(kind as EditableObjectKind) ?? false;
}

/** Every flag this category and this client can carry, grouped for the Inspector. */
export function availableFlags(kind: ObjectKind, version: number): FlagDefinition[] {
  return flagCatalog.filter(
    (definition) => flagSupport(kind, definition.name, version) === "available",
  );
}
