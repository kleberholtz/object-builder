import { create } from "zustand";
import { invalidateSpriteCache } from "../lib/sprite-cache";
import type { ProjectInfo, ThingObject } from "../types/editor";
import { DEFAULT_ZOOM, initialObjectKindFilter, useEditorStore } from "./editor-store";
import { useSelectionStore } from "./selection-store";

interface ProjectState {
  project: ProjectInfo | null;
  objects: ThingObject[];
  sessionVersion: number;
  objectOrderDraft: boolean;
  frameOrderDrafts: Record<string, true>;
  setObjects: (objects: ThingObject[], dirty?: boolean) => void;
  hydrate: (project: ProjectInfo, objects: ThingObject[]) => void;
  markSaved: () => void;
  setProject: (project: ProjectInfo) => void;
  markDirty: () => void;
  adjustObjectCount: (delta: number) => void;
  markObjectOrderDraft: () => void;
  markFrameOrderDraft: (key: string) => void;
  clearFrameOrderDraft: (key: string) => void;
  clearOrderDrafts: () => void;
  reset: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: null,
  objects: [],
  sessionVersion: 0,
  objectOrderDraft: false,
  frameOrderDrafts: {},
  setObjects: (objects, dirty = true) =>
    set((state) => ({
      objects,
      project: state.project
        ? { ...state.project, dirty: dirty ? true : state.project.dirty }
        : null,
    })),
  hydrate: (project, objects) => {
    // The next workspace reuses the same sprite ids for different bytes.
    invalidateSpriteCache();
    useSelectionStore.getState().selectMany([]);
    useEditorStore.setState({
      zoom: DEFAULT_ZOOM,
      activeFrameGroup: 0,
      selectedFrames: [0],
      objectKindFilter: initialObjectKindFilter(),
      inspectorTab: "object",
      outfitPreviewColors: {},
      outfitPreviewDirections: {},
      outfitPreviewAddons: {},
      outfitPreviewWithBody: {},
    });
    set((state) => ({
      project,
      objects,
      objectOrderDraft: false,
      frameOrderDrafts: {},
      sessionVersion: state.sessionVersion + 1,
    }));
  },
  markSaved: () =>
    set((state) => ({ project: state.project ? { ...state.project, dirty: false } : null })),
  setProject: (project) => set({ project }),
  markDirty: () =>
    set((state) => ({ project: state.project ? { ...state.project, dirty: true } : null })),
  adjustObjectCount: (delta) =>
    set((state) => ({
      project: state.project
        ? {
            ...state.project,
            objectCount: Math.max(0, state.project.objectCount + delta),
            dirty: true,
          }
        : null,
    })),
  markObjectOrderDraft: () => set({ objectOrderDraft: true }),
  markFrameOrderDraft: (key) =>
    set((state) => ({ frameOrderDrafts: { ...state.frameOrderDrafts, [key]: true } })),
  clearFrameOrderDraft: (key) =>
    set((state) => {
      const frameOrderDrafts = { ...state.frameOrderDrafts };
      delete frameOrderDrafts[key];
      return { frameOrderDrafts };
    }),
  clearOrderDrafts: () => set({ objectOrderDraft: false, frameOrderDrafts: {} }),
  reset: () => {
    useSelectionStore.getState().selectMany([]);
    useEditorStore.setState({
      zoom: DEFAULT_ZOOM,
      activeFrameGroup: 0,
      selectedFrames: [0],
      objectKindFilter: initialObjectKindFilter(),
      inspectorTab: "object",
      outfitPreviewColors: {},
      outfitPreviewDirections: {},
      outfitPreviewAddons: {},
      outfitPreviewWithBody: {},
    });
    set((state) => ({
      project: null,
      objects: [],
      objectOrderDraft: false,
      frameOrderDrafts: {},
      sessionVersion: state.sessionVersion + 1,
    }));
  },
}));
