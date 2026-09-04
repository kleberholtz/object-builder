import { ChevronDown, Filter, Layers3, ListFilter, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Button } from "../../components/ui/button";
import { SpritePreview } from "../sprites/SpritePreview";
import { useProjectStore } from "../../stores/project-store";
import { useSelectionStore } from "../../stores/selection-store";
import type { ObjectKind } from "../../types/editor";
import { objectKey } from "../../lib/utils";

type FilterKind = "All" | ObjectKind;
const tabs: FilterKind[] = ["All", "Item", "Outfit", "Effect"];

export function ObjectBrowser() {
  const objects = useProjectStore((state) => state.objects);
  const projectName = useProjectStore((state) => state.project.name);
  const setObjects = useProjectStore((state) => state.setObjects);
  const selectedKeys = useSelectionStore((state) => state.selectedKeys);
  const select = useSelectionStore((state) => state.select);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKind>("All");
  const [remoteTotal, setRemoteTotal] = useState<number | null>(null);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const timer = window.setTimeout(() => {
      invoke<{ objects: typeof objects; total: number }>("list_objects", { query: query || null, kind: filter === "All" ? null : filter, offset: 0, limit: 200 })
        .then((page) => { setObjects(page.objects, false); setRemoteTotal(page.total); })
        .catch(() => undefined);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [filter, projectName, query, setObjects]);
  const filtered = useMemo(() => objects.filter((object) => {
    const matchesQuery = !query || object.name.toLowerCase().includes(query.toLowerCase()) || String(object.id).includes(query);
    return matchesQuery && (filter === "All" || object.kind === filter);
  }), [filter, objects, query]);

  return (
    <aside className="object-browser panel-border-right">
      <div className="panel-heading"><span><Layers3 size={14} />Objects</span><div><Button variant="ghost" size="icon"><SlidersHorizontal size={13} /></Button><Button variant="ghost" size="icon"><ListFilter size={13} /></Button></div></div>
      <div className="browser-search"><Search size={13} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by ID or name…" /></div>
      <div className="object-tabs">
        {tabs.map((tab) => <button key={tab} className={filter === tab ? "active" : ""} onClick={() => setFilter(tab)}>{tab === "All" ? "All" : `${tab}s`}</button>)}
      </div>
      <button className="filter-row"><span><Filter size={12} />All properties</span><ChevronDown size={12} /></button>
      <div className="list-header"><span>Object</span><span>Type</span></div>
      <ScrollArea className="object-list">
        {filtered.map((object) => {
          const key = objectKey(object);
          const selected = selectedKeys.includes(key);
          return (
            <button key={key} className={`object-row ${selected ? "selected" : ""}`} onClick={(event) => select(key, event.ctrlKey || event.metaKey)}>
              <div className="thumb-wrap"><SpritePreview spriteId={object.spriteId} size={38} />{object.modified && <span className="modified-dot" />}</div>
              <div className="object-copy"><strong>{object.name}</strong><span>#{object.id} · SPR {object.spriteId}</span></div>
              <span className={`kind-badge kind-${object.kind.toLowerCase()}`}>{object.kind}</span>
            </button>
          );
        })}
        {!filtered.length && <div className="empty-list">No objects found</div>}
      </ScrollArea>
      <div className="browser-footer"><span>{filtered.length} shown</span><span>1–{filtered.length} of {(remoteTotal ?? 32768).toLocaleString()}</span></div>
    </aside>
  );
}
