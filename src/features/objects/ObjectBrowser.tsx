import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, ChevronRight, Filter, Layers3, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Button } from "../../components/ui/button";
import { SpritePreview } from "../sprites/SpritePreview";
import { useProjectStore } from "../../stores/project-store";
import { useSelectionStore } from "../../stores/selection-store";
import type { ObjectKind, ThingObject } from "../../types/editor";
import { objectKey } from "../../lib/utils";

type FilterKind = "All" | Exclude<ObjectKind, "Unknown">;
type Filters = { animated: boolean | null; modified: boolean | null; hasLight: boolean | null; multiTile: boolean | null };
const categories: Array<{ value: FilterKind; label: string }> = [{ value: "Item", label: "Items" }, { value: "Outfit", label: "Outfits" }, { value: "Effect", label: "Effects" }, { value: "Missile", label: "Missiles" }];
const emptyFilters: Filters = { animated: null, modified: null, hasLight: null, multiTile: null };

function TriStateFilter({ label, value, onChange }: { label: string; value: boolean | null; onChange: (value: boolean | null) => void }) {
  return <button className="tri-filter" onClick={() => onChange(value === null ? true : value ? false : null)}><span>{label}</span><em>{value === null ? "Any" : value ? "Yes" : "No"}</em></button>;
}

export function ObjectBrowser() {
  const objects = useProjectStore((state) => state.objects);
  const projectName = useProjectStore((state) => state.project?.name ?? "");
  const setObjects = useProjectStore((state) => state.setObjects);
  const selectedKeys = useSelectionStore((state) => state.selectedKeys);
  const select = useSelectionStore((state) => state.select);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKind>("All");
  const [expanded, setExpanded] = useState(() => localStorage.getItem("object-browser-expanded") !== "false");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [remoteTotal, setRemoteTotal] = useState(0);
  const activeFilterCount = Object.values(filters).filter((value) => value !== null).length;

  useEffect(() => { localStorage.setItem("object-browser-expanded", String(expanded)); }, [expanded]);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const timer = window.setTimeout(() => {
      invoke<{ objects: ThingObject[]; total: number }>("list_objects", { query: query || null, kind: filter === "All" ? null : filter, filters, offset: 0, limit: 300 })
        .then((page) => { setObjects(page.objects, false); setRemoteTotal(page.total); })
        .catch(() => undefined);
    }, 160);
    return () => window.clearTimeout(timer);
  }, [filter, filters, projectName, query, setObjects]);

  const filtered = useMemo(() => objects.filter((object) => {
    const animated = object.frameGroups.some((group) => group.frames.length > 1);
    return (!query || object.name.toLowerCase().includes(query.toLowerCase()) || String(object.id).includes(query))
      && (filter === "All" || object.kind === filter)
      && (filters.animated === null || filters.animated === animated)
      && (filters.modified === null || filters.modified === Boolean(object.modified))
      && (filters.hasLight === null || filters.hasLight === (object.gameplay.lightLevel > 0))
      && (filters.multiTile === null || filters.multiTile === (object.dimensions.width > 1 || object.dimensions.height > 1));
  }), [filter, filters, objects, query]);

  return <aside className="object-browser panel-border-right">
    <div className="panel-heading"><span><Layers3 size={14} />Objects</span><Popover.Root><Popover.Trigger asChild><Button variant="ghost" size="icon" aria-label="Object filters"><SlidersHorizontal size={13} /></Button></Popover.Trigger><Popover.Portal><Popover.Content className="filter-popover" sideOffset={4} collisionPadding={8}><header><strong>Object filters</strong>{activeFilterCount > 0 && <button onClick={() => setFilters(emptyFilters)}>Clear all</button>}</header><TriStateFilter label="Animated" value={filters.animated} onChange={(animated) => setFilters({ ...filters, animated })} /><TriStateFilter label="Modified" value={filters.modified} onChange={(modified) => setFilters({ ...filters, modified })} /><TriStateFilter label="Has light" value={filters.hasLight} onChange={(hasLight) => setFilters({ ...filters, hasLight })} /><TriStateFilter label="Multiple tiles" value={filters.multiTile} onChange={(multiTile) => setFilters({ ...filters, multiTile })} /><Popover.Arrow className="popover-arrow" /></Popover.Content></Popover.Portal></Popover.Root></div>
    <div className="browser-search"><Search size={13} /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by ID or name…" />{query && <button className="search-clear" onClick={() => setQuery("")} aria-label="Clear search"><X size={11} /></button>}</div>
    <div className="category-tree"><button className={filter === "All" ? "active" : ""} onClick={() => setFilter("All")}><span onClick={(event) => { event.stopPropagation(); setExpanded(!expanded); }}>{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>All</button>{expanded && <div>{categories.map((category) => <button key={category.value} className={filter === category.value ? "active" : ""} onClick={() => setFilter(category.value)}>{category.label}</button>)}</div>}</div>
    <button className="filter-row" onClick={() => setFilters(emptyFilters)}><span><Filter size={12} />{activeFilterCount ? `${activeFilterCount} active ${activeFilterCount === 1 ? "filter" : "filters"}` : "All properties"}</span>{activeFilterCount > 0 && <X size={12} />}</button>
    <div className={`list-header ${filter !== "All" ? "single-column" : ""}`}><span>Object</span>{filter === "All" && <span>Type</span>}</div>
    <ScrollArea className="object-list">{filtered.map((object) => { const key = objectKey(object); return <button key={key} className={`object-row ${selectedKeys.includes(key) ? "selected" : ""} ${filter !== "All" ? "without-badge" : ""}`} onClick={(event) => select(key, event.ctrlKey || event.metaKey)}><div className="thumb-wrap"><SpritePreview spriteId={object.spriteId} size={38} />{object.modified && <span className="modified-dot" />}</div><div className="object-copy"><strong>{object.name}</strong><span>#{object.id} · SPR {object.spriteId}</span></div>{filter === "All" && <span className={`kind-badge kind-${object.kind.toLowerCase()}`}>{object.kind}</span>}</button>; })}{!filtered.length && <div className="empty-list">No objects match the current filters</div>}</ScrollArea>
    <div className="browser-footer"><span>{filtered.length} shown</span><span>{remoteTotal.toLocaleString()} total</span></div>
  </aside>;
}
