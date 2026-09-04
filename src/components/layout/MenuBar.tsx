import { Circle } from "lucide-react";
import { AppMenu, MenuItem, MenuSeparator, MenuSub } from "../ui/menu";
import { useEffect, useState } from "react";
import { useProjectStore } from "../../stores/project-store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useT } from "../../lib/i18n";
import {
  loadRecentProjects,
  subscribeRecentProjects,
  type RecentProject,
} from "../../stores/recent-projects";

interface MenuBarProps {
  onSave: () => void;
  onSaveAs: () => void;
  onOpen: () => void;
  onOpenRecent: (entry: RecentProject) => void;
  onImportAny: () => void;
  onImportObject: () => void;
  onExportObject: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onAbout: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onSearchObjects: () => void;
  onHistory: () => void;
  onValidate: () => void;
  onOptimize: () => void;
  onDuplicate: () => void;
  onClose: () => void;
}

export function MenuBar({
  onSave,
  onSaveAs,
  onOpen,
  onOpenRecent,
  onImportAny,
  onImportObject,
  onExportObject,
  onSettings,
  onShortcuts,
  onAbout,
  onCopy,
  onPaste,
  onDelete,
  onSelectAll,
  onSearchObjects,
  onHistory,
  onValidate,
  onOptimize,
  onDuplicate,
  onClose,
}: MenuBarProps) {
  const t = useT();
  const project = useProjectStore((state) => state.project);
  const [recent, setRecent] = useState(loadRecentProjects);
  useEffect(() => subscribeRecentProjects(() => setRecent(loadRecentProjects())), []);
  const windowAction = (action: "minimize" | "maximize" | "close") => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const appWindow = getCurrentWindow();
    if (action === "minimize") void appWindow.minimize();
    else if (action === "maximize") void appWindow.toggleMaximize();
    else onClose();
  };

  return (
    <header className="menu-bar" data-tauri-drag-region>
      <div className="brand-mark" data-tauri-drag-region>
        <img
          className="brand-logo"
          src="/object-builder-logo.png"
          alt=""
          data-tauri-drag-region
        />
        <span data-tauri-drag-region>Object Builder</span>
      </div>
      <nav className="menu-items" aria-label={t("Application menu")}>
        <AppMenu label={t("File")}>
          <MenuItem shortcut="Ctrl+O" onSelect={onOpen}>
            {t("Open client…")}
          </MenuItem>
          <MenuSub label={t("Open recent")}>
            {recent.length ? (
              recent.map((entry) => (
                <MenuItem key={entry.id} onSelect={() => onOpenRecent(entry)}>
                  <span className="recent-menu-item">
                    <strong>{entry.name}</strong>
                    <small>{entry.path}</small>
                  </span>
                </MenuItem>
              ))
            ) : (
              <MenuItem disabled>{t("No recent projects")}</MenuItem>
            )}
          </MenuSub>
          <MenuItem onSelect={onImportAny}>{t("Import file…")}</MenuItem>
          <MenuSeparator className="my-1 h-px bg-border" />
          <MenuItem shortcut="Ctrl+S" onSelect={onSave}>
            {t("Save")}
          </MenuItem>
          <MenuItem shortcut="Ctrl+Shift+S" onSelect={onSaveAs}>
            {t("Save as…")}
          </MenuItem>
          <MenuItem shortcut="F6" onSelect={onSave}>
            {t("Quick save")}
          </MenuItem>
          <MenuSeparator className="my-1 h-px bg-border" />
          <MenuItem onSelect={onImportObject}>{t("Import OBD…")}</MenuItem>
          <MenuItem onSelect={onExportObject}>{t("Export object…")}</MenuItem>
        </AppMenu>
        <AppMenu label={t("Edit")}>
          <MenuItem shortcut="Ctrl+C" onSelect={onCopy}>
            {t("Copy")}
          </MenuItem>
          <MenuItem shortcut="Ctrl+V" onSelect={onPaste}>
            {t("Paste")}
          </MenuItem>
          <MenuItem shortcut="Delete" onSelect={onDelete}>
            {t("Delete")}
          </MenuItem>
          <MenuItem shortcut="Ctrl+A" onSelect={onSelectAll}>
            {t("Select all")}
          </MenuItem>
          <MenuItem shortcut="Ctrl+F" onSelect={onSearchObjects}>
            {t("Search objects")}
          </MenuItem>
          <MenuSeparator className="my-1 h-px bg-border" />
          <MenuItem onSelect={onHistory}>{t("Change history…")}</MenuItem>
        </AppMenu>
        <AppMenu label={t("Objects")}>
          <MenuItem onSelect={onDuplicate}>{t("Duplicate selected object")}</MenuItem>
          <MenuItem shortcut="Delete" onSelect={onDelete}>
            {t("Delete selection")}
          </MenuItem>
          <MenuSeparator className="my-1 h-px bg-border" />
          <MenuItem onSelect={onExportObject}>{t("Export object…")}</MenuItem>
        </AppMenu>
        <AppMenu label={t("Tools")}>
          <MenuItem onSelect={onValidate}>{t("Validate project")}</MenuItem>
          <MenuItem onSelect={onOptimize}>{t("Optimize project…")}</MenuItem>
        </AppMenu>
        <AppMenu label={t("Settings")}>
          <MenuItem onSelect={onSettings}>{t("Application Settings…")}</MenuItem>
          <MenuSeparator className="my-1 h-px bg-border" />
          <MenuItem onSelect={onShortcuts}>{t("Keyboard Shortcuts…")}</MenuItem>
        </AppMenu>
        <AppMenu label={t("Help")}>
          <MenuItem onSelect={onAbout}>{t("About Object Builder")}</MenuItem>
        </AppMenu>
      </nav>
      <div className="project-title" data-tauri-drag-region>
        <Circle size={6} fill={project?.dirty ? "#f0ad4e" : "#63bd82"} stroke="none" />
        <span>{project?.name}</span>
        <span className="project-version">
          {t("Client {version}", { version: project?.clientVersion ?? "" })}
        </span>
      </div>
      <div className="window-controls">
        <button aria-label={t("Minimize window")} onClick={() => windowAction("minimize")}>
          ─
        </button>
        <button aria-label={t("Maximize window")} onClick={() => windowAction("maximize")}>
          □
        </button>
        <button
          aria-label={t("Close window")}
          className="window-close"
          onClick={() => windowAction("close")}
        >
          ×
        </button>
      </div>
    </header>
  );
}
