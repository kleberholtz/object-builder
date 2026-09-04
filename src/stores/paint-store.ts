import { create } from "zustand";
import type { FloatingPixels, PixelMask, Rgba } from "../lib/pixel-editor";

export type PaintTool =
  | "pencil"
  | "eraser"
  | "picker"
  | "bucket"
  | "replace"
  | "line"
  | "rectangle"
  | "ellipse"
  | "marquee"
  | "wand"
  | "move"
  | "pan";

/** Tools that write pixels the moment the pointer goes down and keep writing as it drags. */
export const FREEHAND_TOOLS: PaintTool[] = ["pencil", "eraser"];
/** Tools that show a preview while dragging and only commit on release. */
export const SHAPE_TOOLS: PaintTool[] = ["line", "rectangle", "ellipse"];

/**
 * What the canvas exposes to the rest of the app. Shortcuts are handled once, at the
 * window, and the frame buffer they act on only exists inside the canvas — so the
 * canvas publishes the verbs and the handler calls them.
 */
export interface FrameEditorController {
  ready: boolean;
  copySelection: () => boolean;
  cutSelection: () => boolean;
  pasteClipboard: () => boolean;
  deleteSelection: () => boolean;
  selectAll: () => void;
  deselect: () => void;
  flipHorizontal: () => void;
  flipVertical: () => void;
  rotate: () => void;
}

export const MAX_BRUSH = 8;
export const MAX_RECENT_COLORS = 16;

interface PaintState {
  /** While off, the canvas is the read-only preview it has always been. */
  editMode: boolean;
  tool: PaintTool;
  primary: Rgba;
  secondary: Rgba;
  recentColors: Rgba[];
  brushSize: number;
  shapeFilled: boolean;
  /** 0-255 per channel. Zero means an exact match, which is what pixel art usually wants. */
  tolerance: number;
  /** Which layer of the frame is being painted. Outfits keep their colour mask on layer 1. */
  layer: number;
  /** Stencil every tool writes through; null means the whole frame is writable. */
  selection: PixelMask | null;
  /** Pixels lifted off the frame by a move or a paste, still following the pointer. */
  floating: FloatingPixels | null;
  clipboard: FloatingPixels | null;
  onionSkin: boolean;
  /** Ghosts the layers that are not being edited, so a mask can be aligned to its body. */
  showOtherLayers: boolean;
  /**
   * Bumped when something outside the canvas rewrites sprite bytes — undo and redo.
   * The editor refetches the frame it is holding instead of painting on stale pixels.
   */
  revision: number;
  /** Published by the canvas while it holds an editable frame. */
  controller: FrameEditorController | null;
  /**
   * Bumped by every change to sprite bytes, the editor's own strokes included. Film
   * roll and browser thumbnails follow this one; the canvas must not, or it would
   * refetch the frame it has just painted.
   */
  previewRevision: number;
  setEditMode: (editMode: boolean) => void;
  toggleEditMode: () => void;
  setTool: (tool: PaintTool) => void;
  setPrimary: (color: Rgba) => void;
  setSecondary: (color: Rgba) => void;
  swapColors: () => void;
  rememberColor: (color: Rgba) => void;
  setBrushSize: (size: number) => void;
  stepBrushSize: (step: number) => void;
  setShapeFilled: (filled: boolean) => void;
  setTolerance: (tolerance: number) => void;
  setLayer: (layer: number) => void;
  setSelection: (selection: PixelMask | null) => void;
  setFloating: (floating: FloatingPixels | null) => void;
  setClipboard: (clipboard: FloatingPixels | null) => void;
  toggleOnionSkin: () => void;
  setShowOtherLayers: (show: boolean) => void;
  bumpRevision: () => void;
  bumpPreviewRevision: () => void;
  setController: (controller: FrameEditorController | null) => void;
}

export const usePaintStore = create<PaintState>((set, get) => ({
  editMode: false,
  tool: "pencil",
  primary: [255, 255, 255, 255],
  secondary: [0, 0, 0, 255],
  recentColors: [],
  brushSize: 1,
  shapeFilled: false,
  tolerance: 0,
  layer: 0,
  selection: null,
  floating: null,
  clipboard: null,
  onionSkin: false,
  showOtherLayers: true,
  revision: 0,
  previewRevision: 0,
  controller: null,
  setEditMode: (editMode) => set({ editMode }),
  toggleEditMode: () => set((state) => ({ editMode: !state.editMode })),
  setTool: (tool) => set({ tool }),
  setPrimary: (primary) => set({ primary }),
  setSecondary: (secondary) => set({ secondary }),
  swapColors: () => set((state) => ({ primary: state.secondary, secondary: state.primary })),
  rememberColor: (color) =>
    set((state) => {
      const key = color.join(",");
      return {
        recentColors: [color, ...state.recentColors.filter((entry) => entry.join(",") !== key)].slice(
          0,
          MAX_RECENT_COLORS,
        ),
      };
    }),
  setBrushSize: (size) => set({ brushSize: Math.max(1, Math.min(MAX_BRUSH, Math.round(size))) }),
  stepBrushSize: (step) => get().setBrushSize(get().brushSize + step),
  setShapeFilled: (shapeFilled) => set({ shapeFilled }),
  setTolerance: (tolerance) => set({ tolerance: Math.max(0, Math.min(255, Math.round(tolerance))) }),
  setLayer: (layer) => set({ layer: Math.max(0, layer), selection: null, floating: null }),
  setSelection: (selection) => set({ selection }),
  setFloating: (floating) => set({ floating }),
  setClipboard: (clipboard) => set({ clipboard }),
  toggleOnionSkin: () => set((state) => ({ onionSkin: !state.onionSkin })),
  setShowOtherLayers: (showOtherLayers) => set({ showOtherLayers }),
  bumpRevision: () =>
    set((state) => ({ revision: state.revision + 1, previewRevision: state.previewRevision + 1 })),
  bumpPreviewRevision: () => set((state) => ({ previewRevision: state.previewRevision + 1 })),
  setController: (controller) => set({ controller }),
}));

/** Everything that only makes sense for the frame that is open right now. */
export function resetPaintTarget() {
  usePaintStore.setState({ selection: null, floating: null });
}
