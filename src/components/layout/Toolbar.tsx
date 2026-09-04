import {
  Database,
  Download,
  FolderOpen,
  History,
  MousePointer2,
  Redo2,
  Save,
  Search,
  Sparkles,
  Undo2,
  Upload,
} from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { useT } from "../../lib/i18n";
import { useEditorStore } from "../../stores/editor-store";
import { useHistoryStore } from "../../stores/history-store";
import { useShortcutStore } from "../../stores/shortcut-store";

interface ToolbarProps {
  onCommandPalette: () => void;
  onHistory: () => void;
  onSave: () => void;
  onOpen: () => void;
  onImport: () => void;
  onExport: () => void;
  onOptimize: () => void;
  onSpriteManager: () => void;
}

export function Toolbar({
  onCommandPalette,
  onHistory,
  onSave,
  onOpen,
  onImport,
  onExport,
  onOptimize,
  onSpriteManager,
}: ToolbarProps) {
  const t = useT();
  const { activeTool, setActiveTool } = useEditorStore();
  const { past, future, undo, redo } = useHistoryStore();
  const paletteShortcut = useShortcutStore(
    (state) => state.bindings.commandPalette,
  );
  return (
    <div className="main-toolbar">
      <div className="toolbar-group">
        <Tooltip
          label={t("Open Client")}
          description={t(
            "Configures and loads an existing DAT and SPR client.",
          )}
          shortcut="Ctrl+O"
        >
          <Button variant="ghost" size="icon" onClick={onOpen}>
            <FolderOpen size={15} />
          </Button>
        </Tooltip>
        <Tooltip
          label={t("Save Client")}
          description={t(
            "Writes the active DAT/SPR/OTFI files safely in the background.",
          )}
          shortcut="Ctrl+S"
        >
          <Button variant="ghost" size="icon" onClick={onSave}>
            <Save size={15} />
          </Button>
        </Tooltip>
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <Tooltip
          label={t("Undo")}
          description={t("Restores the object state before the latest edit.")}
          shortcut="Ctrl+Z"
        >
          <Button
            variant="ghost"
            size="icon"
            disabled={!past.length}
            onClick={undo}
          >
            <Undo2 size={15} />
          </Button>
        </Tooltip>
        <Tooltip
          label={t("Redo")}
          description={t("Reapplies the most recently undone object edit.")}
          shortcut="Ctrl+Shift+Z"
        >
          <Button
            variant="ghost"
            size="icon"
            disabled={!future.length}
            onClick={redo}
          >
            <Redo2 size={15} />
          </Button>
        </Tooltip>
        <Tooltip
          label={t("Change history")}
          description={t("Lists every recorded edit and travels back to any of them.")}
        >
          <Button
            variant="ghost"
            size="icon"
            disabled={!past.length && !future.length}
            onClick={onHistory}
          >
            <History size={15} />
          </Button>
        </Tooltip>
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <Tooltip
          label={t("Select")}
          description={t(
            "Selects objects and frames for inspection or editing.",
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className={activeTool === "select" ? "tool-active" : ""}
            onClick={() => setActiveTool("select")}
          >
            <MousePointer2 size={15} />
          </Button>
        </Tooltip>
      </div>
      <div className="toolbar-spacer" />
      <Tooltip
        label={t("Command palette")}
        description={t("Finds any command, panel or tab by name.")}
        shortcut={paletteShortcut}
      >
        <button className="command-trigger" onClick={onCommandPalette}>
          <Search size={13} />
          <span>{t("Search commands…")}</span>
          <kbd>{paletteShortcut}</kbd>
        </button>
      </Tooltip>
      <div className="toolbar-group">
        <Tooltip
          label={t("View All Sprites")}
          description={t(
            "Opens paginated sprite statistics and the indexed object usage graph.",
          )}
        >
          <Button variant="ghost" size="sm" onClick={onSpriteManager}>
            <Database size={14} />
            {t("View All Sprites")}
          </Button>
        </Tooltip>
        <Tooltip
          label={t("Import")}
          description={t("Imports DAT/SPR, JSON, OBD, PNG or a spritesheet.")}
        >
          <Button variant="ghost" size="sm" onClick={onImport}>
            <Upload size={14} />
            {t("Import")}
          </Button>
        </Tooltip>
        <Tooltip
          label={t("Export Object")}
          description={t(
            "Exports the selected object as lossless OBD, rendered PNG or spritesheet.",
          )}
        >
          <Button variant="ghost" size="sm" onClick={onExport}>
            <Download size={14} />
            {t("Export")}
          </Button>
        </Tooltip>
        <Tooltip
          label={t("Optimize Project")}
          description={t(
            "Analyzes unused, missing and duplicate sprites, then offers only confirmed safe cleanup.",
          )}
        >
          <Button variant="subtle" size="sm" onClick={onOptimize}>
            <Sparkles size={14} />
            {t("Optimize")}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
