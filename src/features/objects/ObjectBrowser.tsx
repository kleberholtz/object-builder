import * as Popover from "@radix-ui/react-popover";
import {
  Copy,
  Download,
  ExternalLink,
  Film,
  Layers3,
  ListOrdered,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Tooltip } from "../../components/ui/tooltip";
import { Pagination, usePersistentPageSize } from "../../components/ui/pagination";
import { ContextActionMenu, type ContextMenuState } from "../../components/ui/context-action-menu";
import { formatHumanBytes, objectKey } from "../../lib/utils";
import { tr, useT } from "../../lib/i18n";
import { useVirtualWindow } from "../../lib/virtual";
import { useEditorStore, type ObjectKindFilter } from "../../stores/editor-store";
import { useProjectStore } from "../../stores/project-store";
import { useSelectionStore } from "../../stores/selection-store";
import { writeLog } from "../../stores/log-store";
import { flushCoreMutations, useHistoryStore } from "../../stores/history-store";
import { useSettingsStore } from "../../stores/settings-store";
import type { ThingObject } from "../../types/editor";
import { SpritePreview } from "../sprites/SpritePreview";

type Filters = {
  animated: boolean | null;
  modified: boolean | null;
  hasLight: boolean | null;
  multiTile: boolean | null;
};
type DropPosition = "before" | "after";
interface ObjectDropTarget {
  key: string;
  position: DropPosition;
}
interface ApplyOrderResult {
  changedObjects: number;
  changedFrames: number;
}
const categories: Array<{ value: ObjectKindFilter; label: string }> = [
  { value: "All", label: "All" },
  { value: "Item", label: "Items" },
  { value: "Outfit", label: "Outfits" },
  { value: "Effect", label: "Effects" },
  { value: "Missile", label: "Missiles" },
];
const sortOptions = [
  "idAsc",
  "idDesc",
  "sizeDesc",
  "sizeAsc",
  "nameAsc",
  "nameDesc",
  "spriteAsc",
  "spriteDesc",
  "modified",
  "manual",
] as const;
const sortLabels: Record<(typeof sortOptions)[number], string> = {
  idAsc: "ID ↑",
  idDesc: "ID ↓",
  sizeDesc: "Heaviest",
  sizeAsc: "Lightest",
  nameAsc: "Name ↑",
  nameDesc: "Name ↓",
  spriteAsc: "Sprite ↑",
  spriteDesc: "Sprite ↓",
  modified: "Modified",
  manual: "Manual",
};
const emptyFilters: Filters = { animated: null, modified: null, hasLight: null, multiTile: null };
// Same rule the backend applies to the "Animated" filter: a group with more than
// one frame. The longest group is what the badge counts.
function animationLength(object: ThingObject) {
  return object.frameGroups.reduce((longest, group) => Math.max(longest, group.frames.length), 0);
}
// Matches `.object-row` in the stylesheet; the first mounted row replaces it with
// its measured height, so a CSS change cannot desynchronize the scroll spacers.
const ESTIMATED_ROW_HEIGHT = 61;

function TriStateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  const t = useT();
  return (
    <button
      className="tri-filter"
      onClick={() => onChange(value === null ? true : value ? false : null)}
    >
      <span>{t(label)}</span>
      <em>{value === null ? t("Any") : value ? t("Yes") : t("No")}</em>
    </button>
  );
}

export function ObjectBrowser() {
  const t = useT();
  const objects = useProjectStore((state) => state.objects);
  const project = useProjectStore((state) => state.project);
  const setObjects = useProjectStore((state) => state.setObjects);
  const adjustObjectCount = useProjectStore((state) => state.adjustObjectCount);
  const objectOrderDraft = useProjectStore((state) => state.objectOrderDraft);
  const frameOrderDrafts = useProjectStore((state) => state.frameOrderDrafts);
  const markObjectOrderDraft = useProjectStore((state) => state.markObjectOrderDraft);
  const clearOrderDrafts = useProjectStore((state) => state.clearOrderDrafts);
  const selectedKeys = useSelectionStore((state) => state.selectedKeys);
  const select = useSelectionStore((state) => state.select);
  const defaultSort = useSettingsStore((state) => state.defaultSort);
  const lastSort = useSettingsStore((state) => state.lastSort);
  const rememberSort = useSettingsStore((state) => state.rememberSort);
  const confirmObjectDelete = useSettingsStore((state) => state.confirmObjectDelete);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const objectSearchFocus = useEditorStore((state) => state.objectSearchFocus);
  const filter = useEditorStore((state) => state.objectKindFilter);
  const chooseObjectType = useEditorStore((state) => state.setObjectKindFilter);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sort, setSortState] = useState(() => (defaultSort === "last" ? lastSort : defaultSort));
  const setSort = (value: typeof sort) => {
    setSortState(value);
    rememberSort(value);
  };
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = usePersistentPageSize();
  const [total, setTotal] = useState(project?.objectCount ?? 0);
  const [loading, setLoading] = useState(true);
  const [byteSizes, setByteSizes] = useState<Record<string, number>>({});
  const [applyingOrder, setApplyingOrder] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [draggedKey, setDraggedKey] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<ObjectDropTarget | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState<ThingObject> | null>(null);
  const activeFilterCount = Object.values(filters).filter((value) => value !== null).length;
  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  const rows = useVirtualWindow({
    count: objects.length,
    rowHeight: ESTIMATED_ROW_HEIGHT,
    overscan: 8,
  });
  useEffect(() => {
    setPage(0);
  }, [filter, filters, pageSize, query, sort]);
  // The search shortcut only bumps a counter — the field is here. Selecting what is already
  // typed lets the next search replace it instead of being appended to it.
  useEffect(() => {
    if (!objectSearchFocus) return;
    searchInput.current?.focus();
    searchInput.current?.select();
  }, [objectSearchFocus]);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      invoke<{ objects: ThingObject[]; byteSizes: number[]; total: number }>("list_objects", {
        query: query || null,
        kind: filter === "All" ? null : filter,
        filters,
        sort,
        offset: page * pageSize,
        limit: pageSize,
      })
        .then((result) => {
          if (!cancelled) {
            setObjects(result.objects, false);
            setByteSizes(
              Object.fromEntries(
                result.objects.map((object, index) => [
                  objectKey(object),
                  result.byteSizes[index] ?? 0,
                ]),
              ),
            );
            setTotal(result.total);
          }
        })
        .catch((error) => {
          if (!cancelled)
            writeLog(
              "ERROR",
              tr("Unable to load object page"),
              tr("Page {page}", { page: page + 1 }),
              typeof error === "string" ? error : JSON.stringify(error),
            );
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filter, filters, page, pageSize, project?.name, query, reloadVersion, setObjects, sort]);
  useEffect(() => {
    rows.scrollToTop();
  }, [filter, filters, page, pageSize, project?.name, query, rows.scrollToTop, sort]);

  const reorder = async (sourceKey: string, targetKey: string, position: DropPosition) => {
    if (sort !== "manual" || sourceKey === targetKey) return;
    const from = objects.findIndex((entry) => objectKey(entry) === sourceKey);
    const target = objects.findIndex((entry) => objectKey(entry) === targetKey);
    if (from < 0 || target < 0) return;
    const previous = [...objects];
    const reordered = [...objects];
    const [moved] = reordered.splice(from, 1);
    let insertion = target - (from < target ? 1 : 0);
    if (position === "after") insertion += 1;
    insertion = Math.max(0, Math.min(reordered.length, insertion));
    if (insertion === from) return;
    reordered.splice(insertion, 0, moved);
    setObjects(reordered);
    try {
      await flushCoreMutations();
      await invoke("reorder_things", {
        identities: reordered.map(({ id, kind }) => ({ id, kind })),
      });
      markObjectOrderDraft();
      writeLog(
        "INFO",
        tr("Moved {kind} #{id} to position {position}", {
          kind: tr(moved.kind),
          id: moved.id,
          position: insertion + 1,
        }),
        tr("Manual object order is pending application"),
      );
    } catch (error) {
      setObjects(previous, false);
      writeLog("ERROR", tr("Unable to reorder objects"), undefined, String(error));
    }
  };
  const duplicate = async (object: ThingObject) => {
    try {
      await flushCoreMutations();
      const created = await invoke<ThingObject>("duplicate_thing", {
        identity: { id: object.id, kind: object.kind },
      });
      setObjects([...objects, created]);
      setByteSizes((sizes) => ({ ...sizes, [objectKey(created)]: sizes[objectKey(object)] ?? 0 }));
      adjustObjectCount(1);
      select(objectKey(created));
      writeLog(
        "INFO",
        tr("Duplicated {kind} #{id} as #{newId}", {
          kind: tr(object.kind),
          id: object.id,
          newId: created.id,
        }),
      );
    } catch (error) {
      writeLog(
        "ERROR",
        tr("Unable to duplicate {kind} #{id}", { kind: tr(object.kind), id: object.id }),
        undefined,
        String(error),
      );
    }
  };
  const remove = async (object: ThingObject) => {
    if (
      confirmObjectDelete &&
      !window.confirm(t("Delete {kind} #{id}?", { kind: t(object.kind), id: object.id }))
    )
      return;
    try {
      await flushCoreMutations();
      await invoke("delete_things", { identities: [{ id: object.id, kind: object.kind }] });
      setObjects(objects.filter((entry) => objectKey(entry) !== objectKey(object)));
      adjustObjectCount(-1);
      markObjectOrderDraft();
      if (selectedKeys.includes(objectKey(object))) useSelectionStore.getState().selectMany([]);
      writeLog(
        "INFO",
        tr("Deleted {kind} #{id}", { kind: tr(object.kind), id: object.id }),
        tr("Object IDs are pending application"),
      );
    } catch (error) {
      writeLog(
        "ERROR",
        tr("Unable to delete {kind} #{id}", { kind: tr(object.kind), id: object.id }),
        undefined,
        String(error),
      );
    }
  };
  const exportObject = async (object: ThingObject) => {
    const path = await saveDialog({
      title: t("Export Object as OBD"),
      defaultPath: `${object.kind.toLowerCase()}-${object.id}.obd`,
      filters: [{ name: t("Object Builder Object"), extensions: ["obd"] }],
    });
    if (!path) return;
    const outputPath = path.toLowerCase().endsWith(".obd") ? path : `${path}.obd`;
    try {
      await flushCoreMutations();
      await invoke("export_object", {
        request: { objectId: object.id, kind: object.kind, path: outputPath },
      });
      writeLog(
        "INFO",
        tr("Exported {kind} #{id}", { kind: tr(object.kind), id: object.id }),
        outputPath,
      );
    } catch (error) {
      writeLog(
        "ERROR",
        tr("Unable to export {kind} #{id}", { kind: tr(object.kind), id: object.id }),
        outputPath,
        String(error),
      );
    }
  };
  const exportImage = async (object: ThingObject, mode: "frame" | "spritesheet") => {
    const path = await saveDialog({
      title: mode === "frame" ? t("Export Object as PNG") : t("Export Object as Spritesheet"),
      defaultPath: `${object.kind.toLowerCase()}-${object.id}${mode === "frame" ? "" : "-spritesheet"}.png`,
      filters: [{ name: t("PNG image"), extensions: ["png"] }],
    });
    if (!path) return;
    const outputPath = path.toLowerCase().endsWith(".png") ? path : `${path}.png`;
    try {
      await flushCoreMutations();
      await invoke("export_png", {
        request: {
          objectId: object.id,
          kind: object.kind,
          frameIndex: 0,
          groupIndex: 0,
          mode,
          path: outputPath,
        },
      });
      writeLog(
        "INFO",
        tr(
          mode === "frame"
            ? "Exported {kind} #{id} as PNG"
            : "Exported {kind} #{id} as spritesheet",
          { kind: tr(object.kind), id: object.id },
        ),
        outputPath,
      );
    } catch (error) {
      writeLog(
        "ERROR",
        tr("Unable to export {kind} #{id} as PNG", { kind: tr(object.kind), id: object.id }),
        outputPath,
        String(error),
      );
    }
  };
  const hasOrderDraft = objectOrderDraft || Object.keys(frameOrderDrafts).length > 0;
  const applyOrder = async () => {
    if (applyingOrder || !("__TAURI_INTERNALS__" in window)) return;
    setApplyingOrder(true);
    try {
      await flushCoreMutations();
      const result = await invoke<ApplyOrderResult>("apply_object_order");
      clearOrderDrafts();
      useHistoryStore.getState().reset();
      useSelectionStore.getState().selectMany([]);
      setPage(0);
      setReloadVersion((version) => version + 1);
      writeLog(
        "INFO",
        tr("Order applied: {objects} object IDs and {frames} frame IDs normalized", {
          objects: result.changedObjects,
          frames: result.changedFrames,
        }),
        tr("Ready to save DAT/SPR"),
      );
    } catch (error) {
      writeLog("ERROR", tr("Unable to apply object order"), undefined, String(error));
    } finally {
      setApplyingOrder(false);
    }
  };

  return (
    <aside className="object-browser panel-border-right">
      <div className="panel-heading">
        <span>
          <Layers3 size={14} />
          {t("Objects")} <small>{total.toLocaleString()}</small>
        </span>
        <div className="panel-heading-actions">
          <div className="browser-header-filters">
            <Select
              value={filter}
              onValueChange={(value) => chooseObjectType(value as ObjectKindFilter)}
              ariaLabel={t("Object type")}
              options={categories.map((entry) => ({ value: entry.value, label: t(entry.label) }))}
            />
            <Popover.Root>
              <Popover.Trigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={activeFilterCount ? "filter-active" : ""}
                  aria-label={
                    activeFilterCount
                      ? t("Object filters, {count} active", { count: activeFilterCount })
                      : t("Object filters")
                  }
                >
                  <SlidersHorizontal size={13} />
                  {activeFilterCount > 0 && <i>{activeFilterCount}</i>}
                </Button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content className="filter-popover" sideOffset={4} collisionPadding={8}>
                  <header>
                    <strong>{t("Object filters")}</strong>
                    {activeFilterCount > 0 && (
                      <button onClick={() => setFilters(emptyFilters)}>{t("Clear all")}</button>
                    )}
                  </header>
                  <TriStateFilter
                    label="Animated"
                    value={filters.animated}
                    onChange={(animated) => setFilters({ ...filters, animated })}
                  />
                  <TriStateFilter
                    label="Modified"
                    value={filters.modified}
                    onChange={(modified) => setFilters({ ...filters, modified })}
                  />
                  <TriStateFilter
                    label="Has light"
                    value={filters.hasLight}
                    onChange={(hasLight) => setFilters({ ...filters, hasLight })}
                  />
                  <TriStateFilter
                    label="Multiple tiles"
                    value={filters.multiTile}
                    onChange={(multiTile) => setFilters({ ...filters, multiTile })}
                  />
                  <Popover.Arrow className="popover-arrow" />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </div>
      </div>
      <div className="browser-search-row">
        <div className="browser-search">
          <Search size={13} />
          <Input
            ref={searchInput}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Name, #ID, spr:ID…")}
            title={t("Combine terms such as type:item animated filters or spr:120")}
          />
          {query && (
            <button
              className="search-clear"
              onClick={() => setQuery("")}
              aria-label={t("Clear search")}
            >
              <X size={11} />
            </button>
          )}
        </div>
        <div className="browser-sort">
          <Select
            value={sort}
            onValueChange={(value) => setSort(value as typeof sort)}
            ariaLabel={t("Object ordering")}
            options={sortOptions.map((value) => ({ value, label: t(sortLabels[value]) }))}
          />
        </div>
        <Tooltip
          label={t("Apply order")}
          description={
            hasOrderDraft
              ? t("Commits pending object/frame order and normalizes identifiers.")
              : t("No pending object or frame order changes.")
          }
        >
          <Button
            className={`order-apply-button ${hasOrderDraft ? "draft" : ""}`}
            variant={hasOrderDraft ? "outline" : "ghost"}
            size="sm"
            disabled={!hasOrderDraft || applyingOrder}
            onClick={() => void applyOrder()}
          >
            <ListOrdered size={13} />
            {applyingOrder ? t("Applying…") : t("Apply")}
          </Button>
        </Tooltip>
      </div>
      <div className="list-header">
        <span>{t("Object")}</span>
        <span>{t("Info")}</span>
      </div>
      <ScrollArea className="object-list" viewportRef={rows.viewportRef}>
        {loading ? (
          Array.from({ length: Math.min(pageSize, 8) }, (_, index) => (
            <div className="object-row-skeleton" key={index}>
              <Skeleton className="skeleton-thumb" />
              <div>
                <Skeleton />
                <Skeleton />
              </div>
            </div>
          ))
        ) : (
          <>
            <div style={{ height: rows.paddingTop }} aria-hidden="true" />
            {objects.slice(rows.start, rows.end).map((object, offset) => {
              const key = objectKey(object);
              const bytes = byteSizes[key] ?? 0;
              const frames = animationLength(object);
              const dropClass = dropTarget?.key === key ? `drop-${dropTarget.position}` : "";
              return (
                <button
                  ref={offset === 0 ? rows.measureRow : undefined}
                  draggable={sort === "manual"}
                  title={
                    sort === "manual"
                      ? t("Drag to reorder. The orange line shows the insertion point.")
                      : undefined
                  }
                  key={key}
                  className={`object-row ${selectedKeys.includes(key) ? "selected" : ""} ${draggedKey === key ? "dragging" : ""} ${dropClass}`}
                  onClick={(event) => select(key, event.ctrlKey || event.metaKey)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    select(key);
                    setContextMenu({ x: event.clientX, y: event.clientY, target: object });
                  }}
                  onDragStart={(event) => {
                    setDraggedKey(key);
                    setDropTarget(null);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", key);
                  }}
                  onDragEnd={() => {
                    setDraggedKey(null);
                    setDropTarget(null);
                  }}
                  onDragLeave={(event) => {
                    const next = event.relatedTarget;
                    if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
                      if (dropTarget?.key === key) setDropTarget(null);
                    }
                  }}
                  onDragOver={(event) => {
                    if (sort !== "manual" || draggedKey === key) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setDropTarget({
                      key,
                      position: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
                    });
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const source = draggedKey ?? event.dataTransfer.getData("text/plain");
                    const destination =
                      dropTarget?.key === key ? dropTarget : { key, position: "before" as const };
                    if (source) void reorder(source, destination.key, destination.position);
                    setDraggedKey(null);
                    setDropTarget(null);
                  }}
                >
                  <div className="thumb-wrap">
                    <SpritePreview spriteId={object.spriteId} object={object} size={38} />
                    {object.modified && <span className="modified-dot" />}
                  </div>
                  <div className="object-copy">
                    <strong>{object.name}</strong>
                    <span>
                      #{object.id} · SPR {object.spriteId}
                    </span>
                  </div>
                  <div className="object-badges">
                    <div className="badge-row">
                      {frames > 1 && (
                        <span
                          className="anim-badge"
                          title={t("Animated · {count} frames", { count: frames })}
                        >
                          <Film size={8} />
                          {frames}
                        </span>
                      )}
                      <span className={`kind-badge kind-${object.kind.toLowerCase()}`}>
                        {t(object.kind)}
                      </span>
                    </div>
                    <span
                      className="size-badge"
                      title={t(
                        "{bytes} bytes in SPR storage (unique compressed sprites and index entries)",
                        { bytes: bytes.toLocaleString() },
                      )}
                    >
                      {formatHumanBytes(bytes)}
                    </span>
                  </div>
                </button>
              );
            })}
            <div style={{ height: rows.paddingBottom }} aria-hidden="true" />
          </>
        )}
        {!loading && !objects.length && (
          <div className="empty-list">{t("No objects match the current filters")}</div>
        )}
      </ScrollArea>
      <Pagination
        page={page}
        totalItems={total}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        label="objects"
      />
      <ContextActionMenu
        menu={contextMenu}
        onClose={closeContextMenu}
        actions={
          contextMenu
            ? [
                {
                  label: t("Open"),
                  icon: <ExternalLink size={13} />,
                  onSelect: () => select(objectKey(contextMenu.target)),
                },
                {
                  label: t("Duplicate"),
                  icon: <Copy size={13} />,
                  onSelect: () => void duplicate(contextMenu.target),
                },
                {
                  label: t("Export OBD…"),
                  icon: <Download size={13} />,
                  onSelect: () => void exportObject(contextMenu.target),
                },
                {
                  label: t("Export PNG…"),
                  icon: <Download size={13} />,
                  onSelect: () => void exportImage(contextMenu.target, "frame"),
                },
                {
                  label: t("Export spritesheet…"),
                  icon: <Download size={13} />,
                  onSelect: () => void exportImage(contextMenu.target, "spritesheet"),
                },
                {
                  label: t("Delete"),
                  icon: <Trash2 size={13} />,
                  shortcut: "Delete",
                  danger: true,
                  onSelect: () => void remove(contextMenu.target),
                },
              ]
            : []
        }
      />
    </aside>
  );
}
