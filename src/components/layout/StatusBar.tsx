import { useEffect, useState } from "react";
import { CheckCircle2, CircleDot, Cpu, Database, HardDrive, Layers3 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useProjectStore } from "../../stores/project-store";
import { useSelectionStore } from "../../stores/selection-store";
import { APP_INFO } from "../../lib/app-info";
import { useT } from "../../lib/i18n";
import { formatHumanBytes } from "../../lib/utils";

type MemoryUsage = {
  cacheBytes: number | null;
  cacheCapacityBytes: number | null;
  processBytes: number | null;
};

const MEMORY_POLL_MS = 2000;

// The cache figures come back null while the core is busy saving or
// optimizing; the last known ones are kept instead of blanking the footer.
function useMemoryUsage() {
  const [usage, setUsage] = useState<MemoryUsage | null>(null);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let active = true;
    let pending = false;
    const read = () => {
      if (pending) return;
      pending = true;
      invoke<MemoryUsage>("get_memory_usage")
        .then((value) => {
          if (!active) return;
          setUsage((previous) => ({
            cacheBytes: value.cacheBytes ?? previous?.cacheBytes ?? null,
            cacheCapacityBytes: value.cacheCapacityBytes ?? previous?.cacheCapacityBytes ?? null,
            processBytes: value.processBytes,
          }));
        })
        .catch(() => undefined)
        .finally(() => {
          pending = false;
        });
    };
    read();
    const timer = window.setInterval(read, MEMORY_POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  return usage;
}

export function StatusBar() {
  const t = useT();
  const project = useProjectStore((state) => state.project);
  const selectedKeys = useSelectionStore((state) => state.selectedKeys);
  const memory = useMemoryUsage();
  return (
    <footer className="status-bar">
      <span className="status-ready">
        <CheckCircle2 size={12} />
        {t("Ready")}
      </span>
      <span>
        <Database size={12} />
        {project?.datFile || t("No DAT")}
      </span>
      <span>
        <Layers3 size={12} />
        {project?.sprFile || t("No SPR")}
      </span>
      <span>{t("{count} objects", { count: (project?.objectCount ?? 0).toLocaleString() })}</span>
      <span>{t("{count} sprites", { count: (project?.spriteCount ?? 0).toLocaleString() })}</span>
      <span className="status-spacer" />
      <span>
        <CircleDot size={11} />
        {t("{count} selected", { count: selectedKeys.length })}
      </span>
      <span title={t("Sprite cache in use / capacity")}>
        <HardDrive size={12} />
        {t("Cache {value}", { value: formatHumanBytes(memory?.cacheBytes ?? 0) })}
        {memory?.cacheCapacityBytes != null && ` / ${formatHumanBytes(memory.cacheCapacityBytes)}`}
      </span>
      {memory?.processBytes != null && (
        <span title={t("Memory used by the application")}>
          <Cpu size={12} />
          RAM {formatHumanBytes(memory.processBytes)}
        </span>
      )}
      <span>v{APP_INFO.version}</span>
    </footer>
  );
}
