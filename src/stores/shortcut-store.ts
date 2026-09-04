import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ShortcutAction =
  | "commandPalette"
  | "openClient"
  | "save"
  | "saveAs"
  | "quickSave"
  | "undo"
  | "redo"
  | "copy"
  | "paste"
  | "delete"
  | "selectAll"
  | "searchObjects"
  | "zoomIn"
  | "zoomOut"
  | "resetZoom"
  | "toggleGrid"
  | "toggleEditMode"
  | "toolPencil"
  | "toolEraser"
  | "toolPicker"
  | "toolBucket"
  | "toolReplace"
  | "toolLine"
  | "toolRectangle"
  | "toolEllipse"
  | "toolMarquee"
  | "toolWand"
  | "toolMove"
  | "toolPan"
  | "swapColors"
  | "brushLarger"
  | "brushSmaller"
  | "deselect"
  | "flipHorizontal"
  | "flipVertical"
  | "rotateFrame"
  | "toggleOnionSkin"
  | "previousFrame"
  | "nextFrame";
export interface ShortcutDefinition {
  action: ShortcutAction;
  name: string;
  description: string;
  defaultKeys: string;
  /** Heading the shortcut is listed under. Absent means the application group. */
  group?: string;
}
export const shortcutDefinitions: ShortcutDefinition[] = [
  {
    action: "commandPalette",
    name: "Command Palette",
    description: "Search every command, panel and tab",
    defaultKeys: "Ctrl+K",
  },
  {
    action: "openClient",
    name: "Open Client",
    description: "Configure and load DAT/SPR files",
    defaultKeys: "Ctrl+O",
  },
  {
    action: "save",
    name: "Save",
    description: "Save the active client as DAT/SPR",
    defaultKeys: "Ctrl+S",
  },
  {
    action: "saveAs",
    name: "Save As",
    description: "Save as DAT/SPR or project JSON",
    defaultKeys: "Ctrl+Shift+S",
  },
  {
    action: "quickSave",
    name: "Quick Save",
    description: "Save without showing a dialog",
    defaultKeys: "F6",
  },
  { action: "undo", name: "Undo", description: "Undo the last edit", defaultKeys: "Ctrl+Z" },
  { action: "redo", name: "Redo", description: "Redo the last edit", defaultKeys: "Ctrl+Shift+Z" },
  { action: "copy", name: "Copy", description: "Copy the selected object", defaultKeys: "Ctrl+C" },
  { action: "paste", name: "Paste", description: "Paste an object", defaultKeys: "Ctrl+V" },
  {
    action: "delete",
    name: "Delete",
    description: "Delete the current selection",
    defaultKeys: "Delete",
  },
  {
    action: "selectAll",
    name: "Select All",
    description: "Select all visible objects",
    defaultKeys: "Ctrl+A",
  },
  {
    action: "searchObjects",
    name: "Search Objects",
    description: "Focus the object browser search field",
    defaultKeys: "Ctrl+F",
  },
  { action: "zoomIn", name: "Zoom In", description: "Increase canvas zoom", defaultKeys: "+" },
  { action: "zoomOut", name: "Zoom Out", description: "Decrease canvas zoom", defaultKeys: "-" },
  {
    action: "resetZoom",
    name: "Reset Zoom",
    description: "Restore centered auto-fit with margin",
    defaultKeys: "0",
  },
  {
    action: "toggleGrid",
    name: "Pixel Grid",
    description: "Toggle the pixel grid",
    defaultKeys: "G",
  },
  // Everything below only fires while the canvas is in edit mode, which is what lets a
  // single letter be a tool here and stay free everywhere else.
  {
    action: "toggleEditMode",
    name: "Edit Mode",
    description: "Turn the canvas into a pixel editor",
    defaultKeys: "Ctrl+E",
    group: "Pixel editor",
  },
  {
    action: "toolPencil",
    name: "Pencil",
    description: "Paint with the primary color",
    defaultKeys: "B",
    group: "Pixel editor",
  },
  {
    action: "toolEraser",
    name: "Eraser",
    description: "Clear pixels back to transparent",
    defaultKeys: "E",
    group: "Pixel editor",
  },
  {
    action: "toolPicker",
    name: "Eyedropper",
    description: "Pick the color under the pointer",
    defaultKeys: "I",
    group: "Pixel editor",
  },
  {
    action: "toolBucket",
    name: "Paint Bucket",
    description: "Fill the contiguous region under the pointer",
    defaultKeys: "F",
    group: "Pixel editor",
  },
  {
    action: "toolReplace",
    name: "Replace Color",
    description: "Repaint every pixel of one color in the frame",
    defaultKeys: "Shift+F",
    group: "Pixel editor",
  },
  {
    action: "toolLine",
    name: "Line",
    description: "Draw a straight line",
    defaultKeys: "L",
    group: "Pixel editor",
  },
  {
    action: "toolRectangle",
    name: "Rectangle",
    description: "Draw a rectangle",
    defaultKeys: "U",
    group: "Pixel editor",
  },
  {
    action: "toolEllipse",
    name: "Ellipse",
    description: "Draw an ellipse",
    defaultKeys: "Shift+U",
    group: "Pixel editor",
  },
  {
    action: "toolMarquee",
    name: "Select Pixels",
    description: "Select a rectangular region of the frame",
    defaultKeys: "M",
    group: "Pixel editor",
  },
  {
    action: "toolWand",
    name: "Magic Wand",
    description: "Select the contiguous region of one color",
    defaultKeys: "W",
    group: "Pixel editor",
  },
  {
    action: "toolMove",
    name: "Move Pixels",
    description: "Drag the selected pixels to another place",
    defaultKeys: "V",
    group: "Pixel editor",
  },
  {
    action: "toolPan",
    name: "Pan Canvas",
    description: "Drag the camera while edit mode is on",
    defaultKeys: "H",
    group: "Pixel editor",
  },
  {
    action: "swapColors",
    name: "Swap Colors",
    description: "Exchange the primary and secondary colors",
    defaultKeys: "X",
    group: "Pixel editor",
  },
  {
    action: "brushLarger",
    name: "Larger Brush",
    description: "Grow the pencil and eraser nib",
    defaultKeys: "]",
    group: "Pixel editor",
  },
  {
    action: "brushSmaller",
    name: "Smaller Brush",
    description: "Shrink the pencil and eraser nib",
    defaultKeys: "[",
    group: "Pixel editor",
  },
  {
    action: "deselect",
    name: "Deselect",
    description: "Drop the pixel selection",
    defaultKeys: "Ctrl+D",
    group: "Pixel editor",
  },
  {
    action: "flipHorizontal",
    name: "Flip Horizontally",
    description: "Mirror the edited frame left to right",
    defaultKeys: "Shift+H",
    group: "Pixel editor",
  },
  {
    action: "flipVertical",
    name: "Flip Vertically",
    description: "Mirror the edited frame top to bottom",
    defaultKeys: "Shift+V",
    group: "Pixel editor",
  },
  {
    action: "rotateFrame",
    name: "Rotate Frame",
    description: "Turn the edited frame a quarter turn clockwise",
    defaultKeys: "Shift+R",
    group: "Pixel editor",
  },
  {
    action: "toggleOnionSkin",
    name: "Onion Skin",
    description: "Ghost the neighbouring frames under the current one",
    defaultKeys: "Shift+O",
    group: "Pixel editor",
  },
  {
    action: "previousFrame",
    name: "Previous Frame",
    description: "Open the previous frame of the group",
    defaultKeys: ",",
    group: "Pixel editor",
  },
  {
    action: "nextFrame",
    name: "Next Frame",
    description: "Open the next frame of the group",
    defaultKeys: ".",
    group: "Pixel editor",
  },
];
const defaults = Object.fromEntries(
  shortcutDefinitions.map((item) => [item.action, item.defaultKeys]),
) as Record<ShortcutAction, string>;

interface ShortcutState {
  bindings: Record<ShortcutAction, string>;
  setBinding: (action: ShortcutAction, keys: string, reassign?: boolean) => ShortcutAction | null;
  resetBinding: (action: ShortcutAction) => void;
  resetAll: () => void;
}
export const useShortcutStore = create<ShortcutState>()(
  persist(
    (set, get) => ({
      bindings: defaults,
      setBinding: (action, keys, reassign = false) => {
        const conflict = shortcutDefinitions.find(
          (item) => item.action !== action && get().bindings[item.action] === keys,
        );
        if (conflict && !reassign) return conflict.action;
        set((state) => ({
          bindings: {
            ...state.bindings,
            ...(conflict ? { [conflict.action]: "" } : {}),
            [action]: keys,
          },
        }));
        return null;
      },
      resetBinding: (action) =>
        set((state) => {
          const conflict = shortcutDefinitions.find(
            (item) => item.action !== action && state.bindings[item.action] === defaults[action],
          );
          return {
            bindings: {
              ...state.bindings,
              ...(conflict ? { [conflict.action]: "" } : {}),
              [action]: defaults[action],
            },
          };
        }),
      resetAll: () => set({ bindings: defaults }),
    }),
    {
      name: "object-builder-keyboard-shortcuts",
      version: 1,
      // A binding added after someone saved their shortcuts is missing from the stored
      // object; without this merge the new action would come back unbound for them.
      merge: (persisted, current) => {
        const stored = persisted as Partial<ShortcutState> | undefined;
        return { ...current, ...stored, bindings: { ...defaults, ...stored?.bindings } };
      },
    },
  ),
);

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
