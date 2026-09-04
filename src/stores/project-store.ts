import { create } from "zustand";
import type { ProjectInfo, ThingObject } from "../types/editor";

interface ProjectState {
  project: ProjectInfo | null;
  objects: ThingObject[];
  setObjects: (objects: ThingObject[], dirty?: boolean) => void;
  hydrate: (project: ProjectInfo, objects: ThingObject[]) => void;
  markSaved: () => void;
  reset: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: null,
  objects: [],
  setObjects: (objects, dirty = true) => set((state) => ({
    objects,
    project: state.project ? { ...state.project, dirty: dirty ? true : state.project.dirty } : null,
  })),
  hydrate: (project, objects) => set({ project, objects }),
  markSaved: () => set((state) => ({ project: state.project ? { ...state.project, dirty: false } : null })),
  reset: () => set({ project: null, objects: [] }),
}));
