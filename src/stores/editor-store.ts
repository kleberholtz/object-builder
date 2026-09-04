import { create } from "zustand";

interface EditorState {
  zoom: number;
  showGrid: boolean;
  showCheckerboard: boolean;
  activeTool: "select" | "pencil" | "eraser" | "picker" | "pan";
  activeFrameGroup: number;
  selectedFrames: number[];
  setZoom: (zoom: number) => void;
  toggleGrid: () => void;
  setActiveTool: (tool: EditorState["activeTool"]) => void;
  setActiveFrameGroup: (index: number) => void;
  setSelectedFrames: (frames: number[]) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  zoom: 12,
  showGrid: false,
  showCheckerboard: true,
  activeTool: "select",
  activeFrameGroup: 0,
  selectedFrames: [0],
  setZoom: (zoom) => set({ zoom: Math.max(1, Math.min(20, zoom)) }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  setActiveTool: (activeTool) => set({ activeTool }),
  setActiveFrameGroup: (activeFrameGroup) => set({ activeFrameGroup, selectedFrames: [0] }),
  setSelectedFrames: (selectedFrames) => set({ selectedFrames }),
}));

