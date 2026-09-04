import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ShortcutAction = "openClient" | "save" | "saveAs" | "quickSave" | "undo" | "redo" | "copy" | "paste" | "delete" | "selectAll" | "zoomIn" | "zoomOut" | "resetZoom" | "toggleGrid";
export interface ShortcutDefinition { action: ShortcutAction; name: string; description: string; defaultKeys: string }
export const shortcutDefinitions: ShortcutDefinition[] = [
  { action: "openClient", name: "Open Client", description: "Configure and load DAT/SPR files", defaultKeys: "Ctrl+O" },
  { action: "save", name: "Save", description: "Save the current project", defaultKeys: "Ctrl+S" },
  { action: "saveAs", name: "Save As", description: "Save the project to a new path", defaultKeys: "Ctrl+Shift+S" },
  { action: "quickSave", name: "Quick Save", description: "Save without showing a dialog", defaultKeys: "F6" },
  { action: "undo", name: "Undo", description: "Undo the last edit", defaultKeys: "Ctrl+Z" },
  { action: "redo", name: "Redo", description: "Redo the last edit", defaultKeys: "Ctrl+Shift+Z" },
  { action: "copy", name: "Copy", description: "Copy the selected object", defaultKeys: "Ctrl+C" },
  { action: "paste", name: "Paste", description: "Paste an object", defaultKeys: "Ctrl+V" },
  { action: "delete", name: "Delete", description: "Delete the current selection", defaultKeys: "Delete" },
  { action: "selectAll", name: "Select All", description: "Select all visible objects", defaultKeys: "Ctrl+A" },
  { action: "zoomIn", name: "Zoom In", description: "Increase canvas zoom", defaultKeys: "+" },
  { action: "zoomOut", name: "Zoom Out", description: "Decrease canvas zoom", defaultKeys: "-" },
  { action: "resetZoom", name: "Reset Zoom", description: "Reset canvas zoom to 100%", defaultKeys: "0" },
  { action: "toggleGrid", name: "Pixel Grid", description: "Toggle the pixel grid", defaultKeys: "G" },
];
const defaults = Object.fromEntries(shortcutDefinitions.map((item) => [item.action, item.defaultKeys])) as Record<ShortcutAction, string>;

interface ShortcutState { bindings: Record<ShortcutAction, string>; setBinding: (action: ShortcutAction, keys: string, reassign?: boolean) => ShortcutAction | null; resetBinding: (action: ShortcutAction) => void; resetAll: () => void }
export const useShortcutStore = create<ShortcutState>()(persist((set, get) => ({
  bindings: defaults,
  setBinding: (action, keys, reassign = false) => {
    const conflict = shortcutDefinitions.find((item) => item.action !== action && get().bindings[item.action] === keys);
    if (conflict && !reassign) return conflict.action;
    set((state) => ({ bindings: { ...state.bindings, ...(conflict ? { [conflict.action]: "" } : {}), [action]: keys } }));
    return null;
  },
  resetBinding: (action) => set((state) => {
    const conflict = shortcutDefinitions.find((item) => item.action !== action && state.bindings[item.action] === defaults[action]);
    return { bindings: { ...state.bindings, ...(conflict ? { [conflict.action]: "" } : {}), [action]: defaults[action] } };
  }),
  resetAll: () => set({ bindings: defaults }),
}), { name: "object-builder-keyboard-shortcuts", version: 1 }));

export function keyboardEventToShortcut(event: KeyboardEvent): string {
  const keys: string[] = [];
  if (event.ctrlKey || event.metaKey) keys.push("Ctrl");
  if (event.altKey) keys.push("Alt");
  let key = event.key;
  if (["Control", "Meta", "Alt", "Shift"].includes(key)) return "";
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  if (event.shiftKey && key !== "+") keys.push("Shift");
  keys.push(key);
  return keys.join("+");
}
