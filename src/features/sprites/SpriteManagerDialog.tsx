import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, ExternalLink, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Pagination, usePersistentPageSize } from "../../components/ui/pagination";
import { objectKey } from "../../lib/utils";
import { tr, useT } from "../../lib/i18n";
import { useVirtualWindow } from "../../lib/virtual";
import { writeLog } from "../../stores/log-store";
import type { ObjectKind, ThingObject } from "../../types/editor";
import { SpritePreview } from "./SpritePreview";

interface Statistics {
  total: number;
  inUse: number;
  unused: number;
  objectsUsingSprites: number;
  usedMultipleTimes: number;
  invalidReferences: number;
}
interface SpriteRow {
  id: number;
  objectCount: number;
}
interface SpritePage {
  statistics: Statistics;
  sprites: SpriteRow[];
  total: number;
  offset: number;
}
interface ObjectReference {
  id: number;
  kind: ObjectKind;
  name: string;
}
interface ObjectReferencePage {
  objects: ObjectReference[];
  total: number;
}

// Matches `.sprite-table-body > button`; the first mounted row replaces it with
// its measured height.
const ESTIMATED_SPRITE_ROW_HEIGHT = 44;

const filterOptions = [
  { value: "all", label: "All sprites" },
  { value: "used", label: "Used" },
  { value: "unused", label: "Unused" },
  { value: "once", label: "Used once" },
  { value: "multiple", label: "Used multiple times" },
];

export function SpriteManagerDialog({
  open,
  onOpenChange,
  objectScope,
  onNavigateObject,
  onOptimize,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  objectScope: ThingObject | null;
  onNavigateObject: (reference: ObjectReference) => void;
  onOptimize: () => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<SpritePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [usage, setUsage] = useState<ObjectReferencePage | null>(null);
  const [usagePage, setUsagePage] = useState(0);
  const [pageSize, setPageSize] = usePersistentPageSize();
  const usageRequest = useRef(0);
  const rows = useVirtualWindow({
    count: data?.sprites.length ?? 0,
    rowHeight: ESTIMATED_SPRITE_ROW_HEIGHT,
    overscan: 8,
  });
  const scopeIdentity = useMemo(
    () => (objectScope ? { id: objectScope.id, kind: objectScope.kind } : null),
    [objectScope?.id, objectScope?.kind],
  );

  useEffect(() => {
    usageRequest.current += 1;
    setPage(0);
    setSelected(null);
    setUsage(null);
    setUsagePage(0);
  }, [filter, pageSize, query, objectScope]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      invoke<SpritePage>("get_sprite_statistics", {
        query: query || null,
        filter,
        object: scopeIdentity,
        offset: page * pageSize,
        limit: pageSize,
      })
        .then((result) => {
          if (!cancelled) setData(result);
        })
        .catch((error) => {
          if (!cancelled)
            writeLog("ERROR", tr("Unable to load Sprite Manager"), undefined, String(error));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filter, open, page, pageSize, query, scopeIdentity]);
  useEffect(() => {
    rows.scrollToTop();
  }, [filter, page, pageSize, query, rows.scrollToTop, scopeIdentity]);
  const sprites = data?.sprites ?? [];
  const selectedIndex = selected === null ? -1 : sprites.findIndex((row) => row.id === selected);
  const choose = (id: number) => {
    setSelected(id);
    setUsage(null);
    setUsagePage(0);
  };
  const selectRow = (index: number) => {
    // Scroll first: the row may be outside the mounted window, and it is the
    // viewport position that decides which rows the next render mounts.
    rows.scrollToRow(index);
    choose(sprites[index].id);
  };
  const steps: Record<string, number> = {
    ArrowDown: 1,
    ArrowUp: -1,
    PageDown: 10,
    PageUp: -10,
  };
  const onTableKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!sprites.length) return;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      selectRow(event.key === "Home" ? 0 : sprites.length - 1);
      return;
    }
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    // With nothing selected yet, the first key press picks the end of the list
    // the key points away from.
    selectRow(
      selectedIndex < 0
        ? step > 0
          ? 0
          : sprites.length - 1
        : Math.min(sprites.length - 1, Math.max(0, selectedIndex + step)),
    );
  };
  useEffect(() => {
    if (!open || selected === null) {
      usageRequest.current += 1;
      return;
    }
    const request = ++usageRequest.current;
    setUsage(null);
    // Held arrow keys walk the list a row per repeat; the pane only has to answer
    // for the row someone stopped on.
    const timer = window.setTimeout(() => {
      invoke<ObjectReferencePage>("get_sprite_usage", {
        spriteId: selected,
        offset: usagePage * 100,
        limit: 100,
      })
        .then((result) => {
          if (request === usageRequest.current) setUsage(result);
        })
        .catch((error) =>
          writeLog(
            "ERROR",
            tr("Unable to inspect sprite {id}", { id: selected }),
            undefined,
            String(error),
          ),
        );
    }, 90);
    return () => window.clearTimeout(timer);
  }, [open, selected, usagePage]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={
          objectScope
            ? t("Sprites referenced by {kind} #{id}", {
                kind: t(objectScope.kind),
                id: objectScope.id,
              })
            : t("Sprite Manager")
        }
        description={t("Indexed sprite usage across the complete loaded client.")}
        className="sprite-manager-dialog"
      >
        <div className="sprite-manager-summary">
          {data ? (
            <>
              <Stat
                label={t("Total")}
                value={data.statistics.total}
                filter="all"
                active={filter}
                onFilter={setFilter}
              />
              <Stat
                label={t("In use")}
                value={data.statistics.inUse}
                filter="used"
                active={filter}
                onFilter={setFilter}
              />
              <Stat
                label={t("Unused")}
                value={data.statistics.unused}
                filter="unused"
                active={filter}
                onFilter={setFilter}
              />
              <Stat
                label={t("Objects using sprites")}
                value={data.statistics.objectsUsingSprites}
              />
              <Stat
                label={t("Shared sprites")}
                value={data.statistics.usedMultipleTimes}
                filter="multiple"
                active={filter}
                onFilter={setFilter}
              />
              <Stat
                label={t("Invalid refs")}
                value={data.statistics.invalidReferences}
                warning={data.statistics.invalidReferences > 0}
              />
            </>
          ) : (
            Array.from({ length: 6 }, (_, index) => <Skeleton key={index} />)
          )}
        </div>
        <div className="sprite-manager-toolbar">
          <div className="manager-search">
            <Search size={13} />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value.replace(/[^0-9]/g, ""))}
              placeholder={t("Search Sprite ID…")}
            />
            {query && (
              <button onClick={() => setQuery("")}>
                <X size={11} />
              </button>
            )}
          </div>
          <Select
            value={filter}
            onValueChange={setFilter}
            options={filterOptions.map((entry) => ({ value: entry.value, label: t(entry.label) }))}
            ariaLabel={t("Sprite usage filter")}
          />
        </div>
        <div className="sprite-manager-content">
          <div className="sprite-table">
            <header>
              <span>{t("Sprite ID")}</span>
              <span>{t("Preview")}</span>
              <span>{t("Objects using")}</span>
            </header>
            <div
              className={`sprite-table-body${loading && data ? " busy" : ""}`}
              ref={rows.viewportRef}
              role="listbox"
              tabIndex={0}
              aria-label={t("Sprite ID")}
              aria-busy={loading}
              aria-activedescendant={selected === null ? undefined : `sprite-row-${selected}`}
              onKeyDown={onTableKeyDown}
            >
              {!data ? (
                loading ? (
                  Array.from({ length: 8 }, (_, index) => (
                    <div className="sprite-row-skeleton" key={index}>
                      <Skeleton />
                      <Skeleton />
                      <Skeleton />
                    </div>
                  ))
                ) : (
                  // The index never answered; skeletons here would wait forever.
                  <div className="manager-empty">{t("Unable to load Sprite Manager")}</div>
                )
              ) : (
                <>
                  <div style={{ height: rows.paddingTop }} aria-hidden="true" />
                  {sprites.slice(rows.start, rows.end).map((sprite, offset) => (
                    <button
                      ref={offset === 0 ? rows.measureRow : undefined}
                      key={sprite.id}
                      id={`sprite-row-${sprite.id}`}
                      role="option"
                      tabIndex={-1}
                      aria-selected={selected === sprite.id}
                      className={selected === sprite.id ? "selected" : ""}
                      onClick={() => choose(sprite.id)}
                    >
                      <code>{sprite.id}</code>
                      <SpritePreview spriteId={sprite.id} size={34} />
                      <span className={sprite.objectCount === 0 ? "unused" : ""}>
                        {sprite.objectCount.toLocaleString()}
                      </span>
                    </button>
                  ))}
                  <div style={{ height: rows.paddingBottom }} aria-hidden="true" />
                </>
              )}
              {data && !sprites.length && (
                <div className="manager-empty">{t("No sprites match the current filter.")}</div>
              )}
            </div>
            <Pagination
              page={page}
              totalItems={data?.total ?? 0}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              label="sprites"
            />
          </div>
          <aside className="sprite-usage-detail">
            {selected === null ? (
              <div className="manager-empty">
                {t("Select a sprite to view the objects that reference it.")}
              </div>
            ) : (
              <>
                <header>
                  <SpritePreview spriteId={selected} size={54} />
                  <span>
                    <strong>{t("Sprite {id}", { id: selected })}</strong>
                    <small>{t("Used by {count} objects", { count: usage?.total ?? "…" })}</small>
                  </span>
                </header>
                <div>
                  {usage === null ? (
                    Array.from({ length: 5 }, (_, index) => <Skeleton key={index} />)
                  ) : usage.objects.length ? (
                    usage.objects.map((reference) => (
                      <button
                        key={objectKey(reference)}
                        onClick={() => onNavigateObject(reference)}
                      >
                        <span>
                          <strong>{reference.name}</strong>
                          <small>
                            {t(reference.kind)} #{reference.id}
                          </small>
                        </span>
                        <ExternalLink size={12} />
                      </button>
                    ))
                  ) : (
                    <div className="manager-empty">
                      {t("This sprite is not referenced by any object.")}
                    </div>
                  )}
                </div>
                {usage && usage.total > 100 && (
                  <footer>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={usagePage === 0}
                      onClick={() => setUsagePage(usagePage - 1)}
                    >
                      <ChevronLeft size={12} />
                    </Button>
                    <span>
                      {usagePage + 1} / {Math.ceil(usage.total / 100)}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={(usagePage + 1) * 100 >= usage.total}
                      onClick={() => setUsagePage(usagePage + 1)}
                    >
                      <ChevronRight size={12} />
                    </Button>
                  </footer>
                )}
              </>
            )}
          </aside>
        </div>
        <footer className="dialog-footer">
          <span className="dialog-hint">
            {t("Usage is indexed in Rust and is not recalculated during React renders.")}
          </span>
          <Button variant="outline" onClick={onOptimize}>
            {t("Optimize…")}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{t("Close")}</Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A figure from the index. The three that name a subset of the sprites — total, in
 * use, unused, shared — double as the filter that shows exactly those rows, since
 * reading a count is usually the step before wanting to look at what it counted.
 */
function Stat({
  label,
  value,
  warning = false,
  filter,
  active,
  onFilter,
}: {
  label: string;
  value: number;
  warning?: boolean;
  filter?: string;
  active?: string;
  onFilter?: (filter: string) => void;
}) {
  const body = (
    <>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </>
  );
  if (!filter || !onFilter) return <div className={warning ? "warning" : ""}>{body}</div>;
  return (
    <button
      type="button"
      className={active === filter ? "active" : ""}
      aria-pressed={active === filter}
      onClick={() => onFilter(filter)}
    >
      {body}
    </button>
  );
}
