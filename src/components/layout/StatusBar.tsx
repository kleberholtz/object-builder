import { CheckCircle2, CircleDot, Database, HardDrive, Layers3 } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useSelectionStore } from "../../stores/selection-store";

export function StatusBar() {
  const project = useProjectStore((state) => state.project);
  const selectedKeys = useSelectionStore((state) => state.selectedKeys);
  return (
    <footer className="status-bar">
      <span className="status-ready"><CheckCircle2 size={12} />Ready</span>
      <span><Database size={12} />{project.datFile}</span>
      <span><Layers3 size={12} />{project.sprFile}</span>
      <span>{project.objectCount.toLocaleString()} objects</span>
      <span>{project.spriteCount.toLocaleString()} sprites</span>
      <span className="status-spacer" />
      <span><CircleDot size={11} />{selectedKeys.length} selected</span>
      <span><HardDrive size={12} />Cache 48 MB</span>
      <span>v0.1.0</span>
    </footer>
  );
}
