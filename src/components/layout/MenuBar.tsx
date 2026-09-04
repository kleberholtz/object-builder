import { Boxes, ChevronDown, Circle } from "lucide-react";
import { AppMenu, MenuItem, MenuSeparator } from "../ui/menu";
import { useEditorStore } from "../../stores/editor-store";
import { useProjectStore } from "../../stores/project-store";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface MenuBarProps { onSave: () => void; onOpen: () => void; notify: (message: string) => void }

export function MenuBar({ onSave, onOpen, notify }: MenuBarProps) {
  const project = useProjectStore((state) => state.project);
  const showGrid = useEditorStore((state) => state.showGrid);
  const toggleGrid = useEditorStore((state) => state.toggleGrid);
  const windowAction = (action: "minimize" | "maximize" | "close") => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    if (action === "minimize") void appWindow.minimize();
    else if (action === "maximize") void appWindow.toggleMaximize();
    else void appWindow.close();
  };

  return (
    <header className="menu-bar" data-tauri-drag-region>
      <div className="brand-mark" data-tauri-drag-region><Boxes size={15} strokeWidth={1.8} /><span data-tauri-drag-region>Object Builder</span></div>
      <nav className="menu-items" aria-label="Application menu">
        <AppMenu label="File">
          <MenuItem shortcut="Ctrl+O" onSelect={onOpen}>Open project…</MenuItem>
          <MenuItem shortcut="Ctrl+Shift+O" onSelect={onOpen}>Open client…</MenuItem>
          <MenuSeparator className="my-1 h-px bg-border" />
          <MenuItem shortcut="Ctrl+S" onSelect={onSave}>Save</MenuItem>
          <MenuItem shortcut="Ctrl+Shift+S" onSelect={() => notify("Save As ready")}>Save as…</MenuItem>
          <MenuItem shortcut="F6" onSelect={onSave}>Quick save</MenuItem>
          <MenuSeparator className="my-1 h-px bg-border" />
          <MenuItem onSelect={() => notify("Sprite export queued")}>Export sprite…</MenuItem>
        </AppMenu>
        <AppMenu label="Edit">
          <MenuItem shortcut="Ctrl+Z">Undo</MenuItem><MenuItem shortcut="Ctrl+Shift+Z">Redo</MenuItem>
          <MenuSeparator className="my-1 h-px bg-border" />
          <MenuItem shortcut="Ctrl+C">Copy</MenuItem><MenuItem shortcut="Ctrl+V">Paste</MenuItem>
        </AppMenu>
        <AppMenu label="View">
          <MenuItem shortcut="G" checked={showGrid} onSelect={toggleGrid}>Pixel grid</MenuItem>
          <MenuItem checked>Checkerboard</MenuItem><MenuItem>Center canvas</MenuItem>
        </AppMenu>
        <AppMenu label="Objects"><MenuItem>New object</MenuItem><MenuItem>Duplicate object</MenuItem><MenuItem>Bulk editor…</MenuItem></AppMenu>
        <AppMenu label="Sprites"><MenuItem>Import PNG…</MenuItem><MenuItem>Import spritesheet…</MenuItem><MenuItem>Export selection…</MenuItem></AppMenu>
        <AppMenu label="Tools"><MenuItem>Spritesheet slicer…</MenuItem><MenuItem>Bulk replace…</MenuItem><MenuItem>Validate project</MenuItem></AppMenu>
        <AppMenu label="Help"><MenuItem>Keyboard shortcuts</MenuItem><MenuItem>About Object Builder</MenuItem></AppMenu>
      </nav>
      <div className="project-title" data-tauri-drag-region>
        <Circle size={6} fill={project.dirty ? "#f0ad4e" : "#63bd82"} stroke="none" />
        <span>{project.name}</span><span className="project-version">Client {project.clientVersion}</span><ChevronDown size={12} />
      </div>
      <div className="window-controls"><button aria-label="Minimize window" onClick={() => windowAction("minimize")}>─</button><button aria-label="Maximize window" onClick={() => windowAction("maximize")}>□</button><button aria-label="Close window" className="window-close" onClick={() => windowAction("close")}>×</button></div>
    </header>
  );
}
