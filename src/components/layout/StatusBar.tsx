import { CheckCircle2, CircleDot, Database, HardDrive, Layers3 } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { useSelectionStore } from "../../stores/selection-store";
import { APP_INFO } from "../../lib/app-info";

export function StatusBar() {
  const project = useProjectStore((state) => state.project);
  const selectedKeys = useSelectionStore((state) => state.selectedKeys);
  return (
    <footer className="status-bar">
      <span className="status-ready"><CheckCircle2 size={12} />Ready</span>
      <span><Database size={12} />{project?.datFile || "No DAT"}</span>
      <span><Layers3 size={12} />{project?.sprFile || "No SPR"}</span>
      <span>{(project?.objectCount ?? 0).toLocaleString()} objects</span>
      <span>{(project?.spriteCount ?? 0).toLocaleString()} sprites</span>
      <span className="status-spacer" />
      <span><CircleDot size={11} />{selectedKeys.length} selected</span>
      <span><HardDrive size={12} />Cache 48 MB</span>
      <span>v{APP_INFO.version}</span>
    </footer>
  );
}
