import { Braces, Download, FolderOpen, Grid3X3, MousePointer2, Redo2, Save, Undo2, Upload, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";
import { useEditorStore } from "../../stores/editor-store";
import { useHistoryStore } from "../../stores/history-store";

interface ToolbarProps { onSave: () => void; onOpen: () => void; onImport: () => void; onExport: () => void; onValidate: () => void }

export function Toolbar({ onSave, onOpen, onImport, onExport, onValidate }: ToolbarProps) {
  const { zoom, setZoom, showGrid, toggleGrid, activeTool, setActiveTool } = useEditorStore();
  const { past, future, undo, redo } = useHistoryStore();
  return (
    <div className="main-toolbar">
      <div className="toolbar-group">
        <Tooltip label="Open client" shortcut="Ctrl+O"><Button variant="ghost" size="icon" onClick={onOpen}><FolderOpen size={15} /></Button></Tooltip>
        <Tooltip label="Save" shortcut="Ctrl+S"><Button variant="ghost" size="icon" onClick={onSave}><Save size={15} /></Button></Tooltip>
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <Tooltip label="Undo" shortcut="Ctrl+Z"><Button variant="ghost" size="icon" disabled={!past.length} onClick={undo}><Undo2 size={15} /></Button></Tooltip>
        <Tooltip label="Redo" shortcut="Ctrl+Shift+Z"><Button variant="ghost" size="icon" disabled={!future.length} onClick={redo}><Redo2 size={15} /></Button></Tooltip>
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <Tooltip label="Select"><Button variant="ghost" size="icon" className={activeTool === "select" ? "tool-active" : ""} onClick={() => setActiveTool("select")}><MousePointer2 size={15} /></Button></Tooltip>
        <Tooltip label="Pixel grid" shortcut="G"><Button variant="ghost" size="icon" className={showGrid ? "tool-active" : ""} onClick={toggleGrid}><Grid3X3 size={15} /></Button></Tooltip>
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group zoom-controls">
        <Button variant="ghost" size="icon" onClick={() => setZoom(zoom - 1)}><ZoomOut size={15} /></Button>
        <button className="zoom-value" onClick={() => setZoom(12)}>{Math.round((zoom / 12) * 100)}%</button>
        <Button variant="ghost" size="icon" onClick={() => setZoom(zoom + 1)}><ZoomIn size={15} /></Button>
      </div>
      <div className="toolbar-spacer" />
      <div className="toolbar-group">
        <Button variant="ghost" size="sm" onClick={onImport}><Upload size={14} />Import</Button>
        <Button variant="ghost" size="sm" onClick={onExport}><Download size={14} />Export</Button>
        <Button variant="subtle" size="sm" onClick={onValidate}><Braces size={14} />Validate</Button>
      </div>
    </div>
  );
}
