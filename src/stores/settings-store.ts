import { create } from "zustand";
import type { ObjectKind } from "../types/editor";

export type Language = "auto" | "en" | "pt";
export type Theme = "auto" | "light" | "dark";
export type DefaultObjectType = Exclude<ObjectKind, "Unknown"> | "last";
export type DefaultFrameGroup = "idle" | "moving" | "last";
export type ObjectSort =
  | "idAsc"
  | "idDesc"
  | "sizeDesc"
  | "sizeAsc"
  | "nameAsc"
  | "nameDesc"
  | "spriteAsc"
  | "spriteDesc"
  | "modified"
  | "manual";
export type DefaultSort = ObjectSort | "last";
export type DefaultCanvasZoom = "auto" | "fit" | "percent" | "last";
export type DefaultFilmRoll = "auto" | "minimized" | "maximized" | "last";
export type DefaultOutfitDirection = "north" | "east" | "south" | "west" | "last";
export type DefaultOutfitAddon = "none" | "addon1" | "addon2" | "all" | "last";
export type CanvasBackground = "checker" | "dark" | "light" | "magenta";
export type OutfitColorPart = "head" | "body" | "legs" | "feet";
export type DefaultOutfitColors = Record<OutfitColorPart, string>;

interface PersistedSettings {
  language: Language;
  theme: Theme;
  defaultObjectType: DefaultObjectType;
  defaultFrameGroup: DefaultFrameGroup;
  defaultSort: DefaultSort;
  defaultCanvasZoom: DefaultCanvasZoom;
  defaultCanvasZoomPercent: number;
  defaultFilmRoll: DefaultFilmRoll;
  defaultOutfitDirection: DefaultOutfitDirection;
  defaultOutfitAddon: DefaultOutfitAddon;
  defaultOutfitColors: DefaultOutfitColors;
  autoPlayAnimation: boolean;
  confirmObjectDelete: boolean;
  noticeDuration: number;
  showGridByDefault: boolean;
  canvasBackground: CanvasBackground;
  smoothScaling: boolean;
  showCanvasOverlays: boolean;
  showTileGrid: boolean;
  showObjectBounds: boolean;
  showDirectionArrows: boolean;
  showCanvasAxes: boolean;
  loopAnimation: boolean;
  animationSpeed: number;
  newFrameDuration: number;
  outfitShowBody: boolean;
  undoLimit: number;
  logRetention: number;
  // Megabytes per SPR volume when a client save also publishes the archive in pieces;
  // `0` writes the single archive only. Persisted so Save (and not only Save As) keeps
  // producing the layout the last explicit choice asked for.
  sprSplitSize: number;
  lastObjectType: Exclude<ObjectKind, "Unknown">;
  lastFrameGroupType: number;
  lastCanvasZoom: number;
  lastFilmRollCollapsed: boolean;
  lastSort: ObjectSort;
  lastOutfitDirection: number;
  lastOutfitAddon: number;
}

interface SettingsState extends PersistedSettings {
  setLanguage: (value: Language) => void;
  setTheme: (value: Theme) => void;
  setDefaultObjectType: (value: DefaultObjectType) => void;
  setDefaultFrameGroup: (value: DefaultFrameGroup) => void;
  setDefaultSort: (value: DefaultSort) => void;
  setDefaultCanvasZoom: (value: DefaultCanvasZoom) => void;
  setDefaultCanvasZoomPercent: (value: number) => void;
  setDefaultFilmRoll: (value: DefaultFilmRoll) => void;
  setDefaultOutfitDirection: (value: DefaultOutfitDirection) => void;
  setDefaultOutfitAddon: (value: DefaultOutfitAddon) => void;
  setDefaultOutfitColor: (part: OutfitColorPart, value: string) => void;
  setAutoPlayAnimation: (value: boolean) => void;
  setConfirmObjectDelete: (value: boolean) => void;
  setNoticeDuration: (value: number) => void;
  setShowGridByDefault: (value: boolean) => void;
  setCanvasBackground: (value: CanvasBackground) => void;
  setSmoothScaling: (value: boolean) => void;
  setShowCanvasOverlays: (value: boolean) => void;
  setShowTileGrid: (value: boolean) => void;
  setShowObjectBounds: (value: boolean) => void;
  setShowDirectionArrows: (value: boolean) => void;
  setShowCanvasAxes: (value: boolean) => void;
  setLoopAnimation: (value: boolean) => void;
  setAnimationSpeed: (value: number) => void;
  setNewFrameDuration: (value: number) => void;
  setOutfitShowBody: (value: boolean) => void;
  setUndoLimit: (value: number) => void;
  setLogRetention: (value: number) => void;
  setSprSplitSize: (value: number) => void;
  resetSettings: () => void;
  rememberObjectType: (value: Exclude<ObjectKind, "Unknown">) => void;
  rememberFrameGroup: (groupType: number) => void;
  rememberCanvasZoom: (zoom: number) => void;
  rememberFilmRoll: (collapsed: boolean) => void;
  rememberSort: (sort: ObjectSort) => void;
  rememberOutfitDirection: (direction: number) => void;
  rememberOutfitAddon: (addon: number) => void;
}

const storageKey = "object-builder-settings-v1";
const defaults: PersistedSettings = {
  language: "auto",
  theme: "auto",
  defaultObjectType: "Item",
  defaultFrameGroup: "idle",
  defaultSort: "idAsc",
  defaultCanvasZoom: "auto",
  defaultCanvasZoomPercent: 100,
  defaultFilmRoll: "auto",
  defaultOutfitDirection: "north",
  defaultOutfitAddon: "none",
  defaultOutfitColors: { head: "#efc48f", body: "#4970b4", legs: "#566073", feet: "#6f4830" },
  autoPlayAnimation: false,
  confirmObjectDelete: true,
  noticeDuration: 3.2,
  showGridByDefault: false,
  canvasBackground: "checker",
  smoothScaling: false,
  showCanvasOverlays: true,
  showTileGrid: false,
  showObjectBounds: true,
  showDirectionArrows: true,
  showCanvasAxes: true,
  loopAnimation: true,
  animationSpeed: 1,
  newFrameDuration: 100,
  outfitShowBody: true,
  undoLimit: 40,
  logRetention: 500,
  sprSplitSize: 0,
  lastObjectType: "Item",
  lastFrameGroupType: 0,
  lastCanvasZoom: 0.92,
  lastFilmRollCollapsed: false,
  lastSort: "idAsc",
  lastOutfitDirection: 0,
  lastOutfitAddon: 0,
};

export const SETTINGS_LIMITS = {
  canvasZoomPercent: { min: 10, max: 400 },
  noticeDuration: { min: 1, max: 15 },
  newFrameDuration: { min: 1, max: 60_000 },
  undoLimit: { min: 5, max: 500 },
  logRetention: { min: 100, max: 5000 },
  // One mebibyte is the floor the Rust splitter accepts; above four gibibytes a volume is
  // larger than the 4 GiB an SPR can address, so it could never be more than one file.
  sprSplitSize: { min: 1, max: 4096 },
} as const;

export const SPR_SPLIT_PRESETS = [32, 64, 96, 128] as const;

function clamp(value: number, { min, max }: { min: number; max: number }, fallback: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

function loadSettings(): PersistedSettings {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(storageKey) ?? "{}") };
  } catch {
    return defaults;
  }
}

function persist(settings: PersistedSettings) {
  localStorage.setItem(storageKey, JSON.stringify(settings));
}

export const useSettingsStore = create<SettingsState>((set) => {
  // Every setter writes the whole persisted snapshot, so the patch is applied to state first.
  const update =
    <Key extends keyof PersistedSettings>(key: Key) =>
    (value: PersistedSettings[Key]) =>
      set((state) => {
        persist({ ...state, [key]: value });
        return { [key]: value } as Pick<PersistedSettings, Key>;
      });
  return {
    ...loadSettings(),
    setLanguage: update("language"),
    setTheme: update("theme"),
    setDefaultObjectType: update("defaultObjectType"),
    setDefaultFrameGroup: update("defaultFrameGroup"),
    setDefaultSort: update("defaultSort"),
    setDefaultCanvasZoom: update("defaultCanvasZoom"),
    setDefaultCanvasZoomPercent: (value) =>
      update("defaultCanvasZoomPercent")(
        clamp(value, SETTINGS_LIMITS.canvasZoomPercent, defaults.defaultCanvasZoomPercent),
      ),
    setDefaultFilmRoll: update("defaultFilmRoll"),
    setDefaultOutfitDirection: update("defaultOutfitDirection"),
    setDefaultOutfitAddon: update("defaultOutfitAddon"),
    setDefaultOutfitColor: (part, value) =>
      set((state) => {
        const defaultOutfitColors = { ...state.defaultOutfitColors, [part]: value };
        persist({ ...state, defaultOutfitColors });
        return { defaultOutfitColors };
      }),
    setAutoPlayAnimation: update("autoPlayAnimation"),
    setConfirmObjectDelete: update("confirmObjectDelete"),
    setNoticeDuration: (value) =>
      update("noticeDuration")(
        Number.isFinite(value)
          ? Math.max(
              SETTINGS_LIMITS.noticeDuration.min,
              Math.min(SETTINGS_LIMITS.noticeDuration.max, Math.round(value * 10) / 10),
            )
          : defaults.noticeDuration,
      ),
    setShowGridByDefault: update("showGridByDefault"),
    setCanvasBackground: update("canvasBackground"),
    setSmoothScaling: update("smoothScaling"),
    setShowCanvasOverlays: update("showCanvasOverlays"),
    setShowTileGrid: update("showTileGrid"),
    setShowObjectBounds: update("showObjectBounds"),
    setShowDirectionArrows: update("showDirectionArrows"),
    setShowCanvasAxes: update("showCanvasAxes"),
    setLoopAnimation: update("loopAnimation"),
    setAnimationSpeed: (value) =>
      update("animationSpeed")(
        Number.isFinite(value) ? Math.max(0.25, Math.min(4, value)) : defaults.animationSpeed,
      ),
    setNewFrameDuration: (value) =>
      update("newFrameDuration")(
        clamp(value, SETTINGS_LIMITS.newFrameDuration, defaults.newFrameDuration),
      ),
    setOutfitShowBody: update("outfitShowBody"),
    setUndoLimit: (value) =>
      update("undoLimit")(clamp(value, SETTINGS_LIMITS.undoLimit, defaults.undoLimit)),
    setLogRetention: (value) =>
      update("logRetention")(clamp(value, SETTINGS_LIMITS.logRetention, defaults.logRetention)),
    // Zero is the "single archive" choice and lives outside the clamped range.
    setSprSplitSize: (value) =>
      update("sprSplitSize")(
        Number.isFinite(value) && value > 0
          ? clamp(value, SETTINGS_LIMITS.sprSplitSize, defaults.sprSplitSize)
          : 0,
      ),
    resetSettings: () =>
      set((state) => {
        // The "last used" memory belongs to the session, not to the preferences being reset.
        const next: PersistedSettings = {
          ...defaults,
          lastObjectType: state.lastObjectType,
          lastFrameGroupType: state.lastFrameGroupType,
          lastCanvasZoom: state.lastCanvasZoom,
          lastFilmRollCollapsed: state.lastFilmRollCollapsed,
          lastSort: state.lastSort,
          lastOutfitDirection: state.lastOutfitDirection,
          lastOutfitAddon: state.lastOutfitAddon,
        };
        persist(next);
        return next;
      }),
    rememberObjectType: update("lastObjectType"),
    rememberFrameGroup: update("lastFrameGroupType"),
    rememberCanvasZoom: update("lastCanvasZoom"),
    rememberFilmRoll: update("lastFilmRollCollapsed"),
    rememberSort: update("lastSort"),
    rememberOutfitDirection: update("lastOutfitDirection"),
    rememberOutfitAddon: update("lastOutfitAddon"),
  };
});
