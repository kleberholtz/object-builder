import { create } from "zustand";
import { useProjectStore } from "./project-store";
import type { ThingObject } from "../types/editor";
import { invoke } from "@tauri-apps/api/core";

interface HistoryState {
  past: ThingObject[][];
  future: ThingObject[][];
  checkpoint: (objects: ThingObject[]) => void;
  undo: () => void;
  redo: () => void;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],
  checkpoint: (objects) => set((state) => ({ past: [...state.past.slice(-39), structuredClone(objects)], future: [] })),
  undo: () => {
    const { past, future } = get();
    if (!past.length) return;
    const current = structuredClone(useProjectStore.getState().objects);
    const previous = past[past.length - 1];
    useProjectStore.getState().setObjects(structuredClone(previous));
    set({ past: past.slice(0, -1), future: [current, ...future] });
    if ("__TAURI_INTERNALS__" in window) void invoke("undo").catch(() => undefined);
  },
  redo: () => {
    const { past, future } = get();
    if (!future.length) return;
    const current = structuredClone(useProjectStore.getState().objects);
    const next = future[0];
    useProjectStore.getState().setObjects(structuredClone(next));
    set({ past: [...past, current], future: future.slice(1) });
    if ("__TAURI_INTERNALS__" in window) void invoke("redo").catch(() => undefined);
  },
}));

export function updateObject(target: Pick<ThingObject, "id" | "kind">, transform: (object: ThingObject) => ThingObject) {
  const state = useProjectStore.getState();
  const current = state.objects.find((object) => object.id === target.id && object.kind === target.kind);
  if (!current) return;
  useHistoryStore.getState().checkpoint(state.objects);
  const updated = { ...transform(current), modified: true };
  state.setObjects(state.objects.map((object) => object === current ? updated : object));
  if ("__TAURI_INTERNALS__" in window) void invoke("update_thing", { object: updated, originalKind: current.kind }).catch(() => undefined);
}
