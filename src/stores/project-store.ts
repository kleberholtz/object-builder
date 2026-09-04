import { create } from "zustand";
import { createDemoObjects } from "../lib/demo-data";
import type { ProjectInfo, ThingObject } from "../types/editor";

interface ProjectState {
  project: ProjectInfo;
  objects: ThingObject[];
  setObjects: (objects: ThingObject[], dirty?: boolean) => void;
  hydrate: (project: ProjectInfo, objects: ThingObject[]) => void;
  markSaved: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  project: {
    name: "Elderan Chronicles",
    clientVersion: "10.98",
    datFile: "Tibia.dat",
    sprFile: "Tibia.spr",
    objectCount: 32768,
    spriteCount: 89412,
    dirty: false,
  },
  objects: createDemoObjects(),
  setObjects: (objects, dirty = true) => set((state) => ({ objects, project: { ...state.project, dirty } })),
  hydrate: (project, objects) => set({ project, objects }),
  markSaved: () => set((state) => ({ project: { ...state.project, dirty: false } })),
}));
