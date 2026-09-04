import { create } from "zustand";
import { useSettingsStore } from "./settings-store";
import type { ObjectKind } from "../types/editor";

export const DEFAULT_ZOOM = 0.92;

export type OutfitColorPart = "head" | "body" | "legs" | "feet";
export type OutfitPreviewColors = Record<OutfitColorPart, string>;

export const DEFAULT_OUTFIT_PREVIEW_COLORS: OutfitPreviewColors = {
  head: "#efc48f",
  body: "#4970b4",
  legs: "#566073",
  feet: "#6f4830",
};

function randomPreviewColor() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  // Keep previews readable: avoid colors that are nearly black or white.
  return `#${Array.from(bytes, (value) => (48 + (value % 160)).toString(16).padStart(2, "0")).join("")}`;
}

export interface CanvasPan {
  x: number;
  y: number;
}

export type ObjectKindFilter = "All" | Exclude<ObjectKind, "Unknown">;
export type InspectorTab = "object" | "server" | "flags";

/** The browser category a fresh workspace opens on, honouring the "remember last" setting. */
export function initialObjectKindFilter(): ObjectKindFilter {
  const settings = useSettingsStore.getState();
  return settings.defaultObjectType === "last"
    ? settings.lastObjectType
    : settings.defaultObjectType;
}

interface EditorState {
  zoom: number;
  pan: CanvasPan;
  showGrid: boolean;
  showCheckerboard: boolean;
  activeTool: "select" | "pencil" | "eraser" | "picker" | "pan";
  activeFrameGroup: number;
  selectedFrames: number[];
  filmRollCollapsed: boolean;
  inspectorCollapsed: boolean;
  objectKindFilter: ObjectKindFilter;
  inspectorTab: InspectorTab;
  /**
   * Bumped by the search shortcut. The query lives inside the browser, so what travels is
   * the request to focus it — a counter, because pressing the chord twice in a row has to
   * reach the field again.
   */
  objectSearchFocus: number;
  outfitPreviewColors: Record<string, OutfitPreviewColors>;
  outfitPreviewDirections: Record<string, number>;
  outfitPreviewAddons: Record<string, number>;
  outfitPreviewWithBody: Record<string, boolean>;
  setZoom: (zoom: number) => void;
  applyZoom: (zoom: number) => void;
  zoomAround: (zoom: number, focal: CanvasPan) => void;
  setPan: (pan: CanvasPan) => void;
  panBy: (dx: number, dy: number) => void;
  resetView: () => void;
  toggleGrid: () => void;
  setActiveTool: (tool: EditorState["activeTool"]) => void;
  setActiveFrameGroup: (index: number) => void;
  setSelectedFrames: (frames: number[]) => void;
  toggleFilmRoll: () => void;
  setFilmRollCollapsed: (collapsed: boolean) => void;
  toggleInspector: () => void;
  setInspectorCollapsed: (collapsed: boolean) => void;
  setObjectKindFilter: (kind: ObjectKindFilter) => void;
  setInspectorTab: (tab: InspectorTab) => void;
  focusObjectSearch: () => void;
  setOutfitPreviewColor: (objectKey: string, part: OutfitColorPart, color: string) => void;
  randomizeOutfitPreviewColors: (objectKey: string) => void;
  resetOutfitPreviewColors: (objectKey: string) => void;
  clearOutfitPreviewColors: () => void;
  rotateOutfitPreview: (objectKey: string, directionCount: number, step: number) => void;
  setOutfitPreviewDirection: (objectKey: string, direction: number) => void;
  initializeOutfitPreview: (objectKey: string, direction: number, addon: number) => void;
  clearOutfitPreviewDirections: () => void;
  setOutfitPreviewAddon: (objectKey: string, addon: number) => void;
  clearOutfitPreviewAddons: () => void;
  setOutfitPreviewWithBody: (objectKey: string, withBody: boolean) => void;
}

// Finer than two decimals so "actual size" (zoom = 1 / fitScale) lands on exactly 1:1.
const clampZoom = (zoom: number) => Math.max(0.02, Math.min(16, Math.round(zoom * 10000) / 10000));

export const useEditorStore = create<EditorState>((set) => ({
  zoom: DEFAULT_ZOOM,
  pan: { x: 0, y: 0 },
  showGrid: useSettingsStore.getState().showGridByDefault,
  showCheckerboard: true,
  activeTool: "select",
  activeFrameGroup: 0,
  selectedFrames: [0],
  filmRollCollapsed: localStorage.getItem("object-builder-film-collapsed") === "true",
  inspectorCollapsed: localStorage.getItem("object-builder-inspector-collapsed") === "true",
  objectKindFilter: initialObjectKindFilter(),
  inspectorTab: "object",
  outfitPreviewColors: {},
  outfitPreviewDirections: {},
  outfitPreviewAddons: {},
  outfitPreviewWithBody: {},
  objectSearchFocus: 0,
  setZoom: (zoom) => {
    const next = clampZoom(zoom);
    useSettingsStore.getState().rememberCanvasZoom(next);
    set({ zoom: next });
  },
  applyZoom: (zoom) => set({ zoom: clampZoom(zoom) }),
  // Keeps the content under `focal` (viewport-centre relative pixels) pinned while the
  // scale changes, which is what makes pinch and ctrl+wheel land where the pointer is.
  zoomAround: (zoom, focal) =>
    set((state) => {
      const next = clampZoom(zoom);
      const ratio = next / state.zoom;
      useSettingsStore.getState().rememberCanvasZoom(next);
      return {
        zoom: next,
        pan: {
          x: focal.x - (focal.x - state.pan.x) * ratio,
          y: focal.y - (focal.y - state.pan.y) * ratio,
        },
      };
    }),
  setPan: (pan) => set({ pan }),
  panBy: (dx, dy) => set((state) => ({ pan: { x: state.pan.x + dx, y: state.pan.y + dy } })),
  resetView: () => set({ zoom: DEFAULT_ZOOM, pan: { x: 0, y: 0 } }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  setActiveTool: (activeTool) => set({ activeTool }),
  setActiveFrameGroup: (activeFrameGroup) => set({ activeFrameGroup, selectedFrames: [0] }),
  setSelectedFrames: (selectedFrames) => set({ selectedFrames }),
  toggleFilmRoll: () =>
    set((state) => {
      const filmRollCollapsed = !state.filmRollCollapsed;
      localStorage.setItem("object-builder-film-collapsed", String(filmRollCollapsed));
      useSettingsStore.getState().rememberFilmRoll(filmRollCollapsed);
      return { filmRollCollapsed };
    }),
  setFilmRollCollapsed: (filmRollCollapsed) => set({ filmRollCollapsed }),
  toggleInspector: () =>
    set((state) => {
      const inspectorCollapsed = !state.inspectorCollapsed;
      localStorage.setItem("object-builder-inspector-collapsed", String(inspectorCollapsed));
      return { inspectorCollapsed };
    }),
  setInspectorCollapsed: (inspectorCollapsed) => {
    localStorage.setItem("object-builder-inspector-collapsed", String(inspectorCollapsed));
    set({ inspectorCollapsed });
  },
  setObjectKindFilter: (objectKindFilter) => {
    if (objectKindFilter !== "All")
      useSettingsStore.getState().rememberObjectType(objectKindFilter);
    set({ objectKindFilter });
  },
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  focusObjectSearch: () => set((state) => ({ objectSearchFocus: state.objectSearchFocus + 1 })),
  setOutfitPreviewColor: (key, part, color) =>
    set((state) => ({
      outfitPreviewColors: {
        ...state.outfitPreviewColors,
        [key]: {
          ...(state.outfitPreviewColors[key] ?? DEFAULT_OUTFIT_PREVIEW_COLORS),
          [part]: color,
        },
      },
    })),
  randomizeOutfitPreviewColors: (key) =>
    set((state) => ({
      outfitPreviewColors: {
        ...state.outfitPreviewColors,
        [key]: {
          head: randomPreviewColor(),
          body: randomPreviewColor(),
          legs: randomPreviewColor(),
          feet: randomPreviewColor(),
        },
      },
    })),
  resetOutfitPreviewColors: (key) =>
    set((state) => {
      const outfitPreviewColors = { ...state.outfitPreviewColors };
      delete outfitPreviewColors[key];
      return { outfitPreviewColors };
    }),
  clearOutfitPreviewColors: () => set({ outfitPreviewColors: {} }),
  rotateOutfitPreview: (key, directionCount, step) =>
    set((state) => {
      const count = Math.max(1, Math.floor(directionCount));
      const current = state.outfitPreviewDirections[key] ?? 0;
      const direction = (current + step + count) % count;
      useSettingsStore.getState().rememberOutfitDirection(direction);
      return { outfitPreviewDirections: { ...state.outfitPreviewDirections, [key]: direction } };
    }),
  setOutfitPreviewDirection: (key, direction) =>
    set((state) => {
      const next = Math.max(0, Math.floor(direction));
      useSettingsStore.getState().rememberOutfitDirection(next);
      return { outfitPreviewDirections: { ...state.outfitPreviewDirections, [key]: next } };
    }),
  initializeOutfitPreview: (key, direction, addon) =>
    set((state) => ({
      outfitPreviewDirections:
        key in state.outfitPreviewDirections
          ? state.outfitPreviewDirections
          : { ...state.outfitPreviewDirections, [key]: direction },
      outfitPreviewAddons:
        key in state.outfitPreviewAddons
          ? state.outfitPreviewAddons
          : { ...state.outfitPreviewAddons, [key]: addon },
    })),
  clearOutfitPreviewDirections: () => set({ outfitPreviewDirections: {} }),
  setOutfitPreviewAddon: (key, addon) =>
    set((state) => {
      const next = addon === -1 ? -1 : Math.max(0, Math.floor(addon));
      useSettingsStore.getState().rememberOutfitAddon(next);
      return { outfitPreviewAddons: { ...state.outfitPreviewAddons, [key]: next } };
    }),
  clearOutfitPreviewAddons: () => set({ outfitPreviewAddons: {} }),
  setOutfitPreviewWithBody: (key, withBody) =>
    set((state) => ({
      outfitPreviewWithBody: { ...state.outfitPreviewWithBody, [key]: withBody },
    })),
}));
