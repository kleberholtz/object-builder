import { Boxes, Circle } from "lucide-react";
import { AppMenu, MenuItem, MenuSeparator } from "../ui/menu";
import { useEditorStore } from "../../stores/editor-store";
import { useProjectStore } from "../../stores/project-store";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface MenuBarProps { onSave: () => void; onSaveAs: () => void; onOpen: () => void; onImportObject: () => void; onExportObject: () => void; onImportPng: (sheet?: boolean) => void; onExportPng: (mode?: string) => void; onShortcuts: () => void; onAbout: () => void; onUndo: () => void; onRedo: () => void; onCopy: () => void; onPaste: () => void; onDelete: () => void; onSelectAll: () => void; onValidate: () => void; onResetZoom: () => void; onDuplicate: () => void; notify: (message: string) => void }

export function MenuBar({ onSave, onSaveAs, onOpen, onImportObject, onExportObject, onImportPng, onExportPng, onShortcuts, onAbout, onUndo, onRedo, onCopy, onPaste, onDelete, onSelectAll, onValidate, onResetZoom, onDuplicate, notify }: MenuBarProps) {
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
          <MenuItem shortcut="Ctrl+O" onSelect={onOpen}>Open client…</MenuItem>
          <MenuSeparator className="my-1 h-px bg-border" />
          <MenuItem shortcut="Ctrl+S" onSelect={onSave}>Save</MenuItem>
          <MenuItem shortcut="Ctrl+Shift+S" onSelect={onSaveAs}>Save as…</MenuItem>
          <MenuItem shortcut="F6" onSelect={onSave}>Quick save</MenuItem>
          <MenuSeparator className="my-1 h-px bg-border" />
          <MenuItem onSelect={onImportObject}>Import object…</MenuItem><MenuItem onSelect={onExportObject}>Export object…</MenuItem>
        </AppMenu>
        <AppMenu label="Edit">
          <MenuItem shortcut="Ctrl+Z" onSelect={onUndo}>Undo</MenuItem><MenuItem shortcut="Ctrl+Shift+Z" onSelect={onRedo}>Redo</MenuItem>
          <MenuSeparator className="my-1 h-px bg-border" />
          <MenuItem shortcut="Ctrl+C" onSelect={onCopy}>Copy</MenuItem><MenuItem shortcut="Ctrl+V" onSelect={onPaste}>Paste</MenuItem><MenuItem shortcut="Delete" onSelect={onDelete}>Delete</MenuItem><MenuItem shortcut="Ctrl+A" onSelect={onSelectAll}>Select all</MenuItem>
        </AppMenu>
        <AppMenu label="View">
          <MenuItem shortcut="G" checked={showGrid} onSelect={toggleGrid}>Pixel grid</MenuItem>
          <MenuItem shortcut="0" onSelect={onResetZoom}>Reset canvas zoom</MenuItem>
        </AppMenu>
        <AppMenu label="Objects"><MenuItem onSelect={onDuplicate}>Duplicate selected object</MenuItem><MenuItem shortcut="Delete" onSelect={onDelete}>Delete selection</MenuItem></AppMenu>
        <AppMenu label="Sprites"><MenuItem onSelect={() => onImportPng(false)}>Import PNG…</MenuItem><MenuItem onSelect={() => onImportPng(true)}>Import spritesheet…</MenuItem><MenuSeparator className="my-1 h-px bg-border" /><MenuItem onSelect={() => onExportPng("frame")}>Export selected frame…</MenuItem><MenuItem onSelect={() => onExportPng("allFrames")}>Export all frames…</MenuItem><MenuItem onSelect={() => onExportPng("object")}>Export complete object…</MenuItem><MenuItem onSelect={() => onExportPng("spritesheet")}>Export spritesheet…</MenuItem></AppMenu>
        <AppMenu label="Tools"><MenuItem onSelect={onValidate}>Validate project</MenuItem></AppMenu>
        <AppMenu label="Settings"><MenuItem onSelect={onShortcuts}>Keyboard Shortcuts…</MenuItem></AppMenu>
        <AppMenu label="Help"><MenuItem onSelect={() => notify("Use Settings → Keyboard Shortcuts to customize commands")}>Keyboard shortcuts</MenuItem><MenuItem onSelect={onAbout}>About Object Builder</MenuItem></AppMenu>
      </nav>
      <div className="project-title" data-tauri-drag-region>
        <Circle size={6} fill={project?.dirty ? "#f0ad4e" : "#63bd82"} stroke="none" />
        <span>{project?.name}</span><span className="project-version">Client {project?.clientVersion}</span>
      </div>
      <div className="window-controls"><button aria-label="Minimize window" onClick={() => windowAction("minimize")}>─</button><button aria-label="Maximize window" onClick={() => windowAction("maximize")}>□</button><button aria-label="Close window" className="window-close" onClick={() => windowAction("close")}>×</button></div>
    </header>
  );
}
