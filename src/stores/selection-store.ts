import { create } from "zustand";

interface SelectionState {
  selectedKeys: string[];
  select: (key: string, additive?: boolean) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedKeys: ["Item:10364"],
  select: (key, additive = false) => set((state) => ({
    selectedKeys: additive
      ? state.selectedKeys.includes(key) ? state.selectedKeys.filter((value) => value !== key) : [...state.selectedKeys, key]
      : [key],
  })),
}));
