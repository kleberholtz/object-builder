import { Channel, invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  CopyMinus,
  Ghost,
  HardDrive,
  Layers,
  Link2Off,
  PackageX,
  Radar,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { Progress } from "../../components/ui/progress";
import { Switch } from "../../components/ui/switch";
import { writeLog } from "../../stores/log-store";
import { tr, useT, type Translate } from "../../lib/i18n";
import { flushCoreMutations } from "../../stores/history-store";
import { useProjectStore } from "../../stores/project-store";
import { SpritePreview } from "../sprites/SpritePreview";

interface DuplicateCandidate {
  id: number;
  usageCount: number;
  storageBytes: number;
  origin: string;
}
interface DuplicateGroup {
  checksum: string;
  sprites: DuplicateCandidate[];
  spriteCount: number;
}
interface OptimizationProgress {
  /** Machine key of the running stage; `status` is its untranslated fallback. */
  stage: string;
  status: string;
  /** What the stage counts — a rewrite pass is measured in objects, not sprites. */
  unit: string;
  stageIndex: number;
  stageCount: number;
  processed: number;
  total: number;
  stagePercent: number;
  /** Share of the whole run, weighted by what each stage costs. */
  percent: number;
  etaSeconds?: number | null;
}

interface OptimizationAnalysis {
  statistics: { total: number; inUse: number; unused: number; invalidReferences: number };
  unusedPreview: number[];
  unusedSourcePreview: number[];
  unusedSourceCount: number;
  unusedSourceReclaimableBytes: number;
  unusedOverrideIds: number[];
  unusedOverrideCount: number;
  invalidReferencePreview: number[];
  invalidReferenceCount: number;
  blankSpriteIds: number[];
  blankSpriteCount: number;
  blankReferenceCount: number;
  blankReclaimableBytes: number;
  emptySlotIds: number[];
  emptySlotCount: number;
  emptySlotReferenceCount: number;
  redundantOverrideIds: number[];
  redundantOverrideCount: number;
  redundantOverrideBytes: number;
  duplicateGroups: DuplicateGroup[];
  duplicateGroupCount: number;
  duplicateCandidateCount: number;
  reclaimableBytes: number;
  duplicateReclaimableBytes: number;
  estimatedReductionPercent: number;
}

interface OptimizationResult {
  removedOverrides: number;
  removedDuplicates: number;
  removedUnusedSprites: number;
  removedBlankSprites: number;
  droppedRedundantOverrides: number;
  clearedBlankReferences: number;
  clearedEmptyReferences: number;
  repairedInvalidReferences: number;
  remappedReferences: number;
  reclaimedBytes: number;
  spriteReplacements: Record<string, number>;
}

/**
 * The operation catalogue is the single source of what Optimize can do: the
 * request flag, the card, the preset membership and the completion sentence all
 * read from the same entry, so a new pass cannot appear in one of them only.
 */
const OPERATION_KEYS = [
  "duplicates",
  "blankSprites",
  "unused",
  "unusedOverrides",
  "redundantOverrides",
  "emptyReferences",
  "invalidReferences",
] as const;
type OperationKey = (typeof OPERATION_KEYS)[number];
type OperationFlags = Record<OperationKey, boolean>;

/** Operations that only drop pixels, versus the ones that rewrite object references. */
const STORAGE_ONLY_OPERATIONS: OperationKey[] = ["unused", "unusedOverrides", "redundantOverrides"];

const noOperations = () =>
  Object.fromEntries(OPERATION_KEYS.map((key) => [key, false])) as OperationFlags;

/**
 * Keeps a late event from an earlier stage — the decode workers report from
 * several threads — from pulling the dialog back to a pass that already ended.
 */
function monotonicProgress(current: OptimizationProgress | null, next: OptimizationProgress) {
  if (!current) return next;
  if (next.stageIndex < current.stageIndex) return current;
  if (next.stageIndex === current.stageIndex && next.processed < current.processed) return current;
  return { ...next, percent: Math.max(current.percent, next.percent) };
}

/** The stage sentences, keyed by what the Rust core reports it is doing. */
const STAGE_LABELS: Record<string, string> = {
  indexing: "Indexing the sprite table",
  hashingOverrides: "Hashing edited sprites",
  comparingOverrides: "Comparing edited sprites against the archive",
  readingChecksums: "Reading cached sprite checksums",
  decodingSprites: "Decoding sprites from the archive",
  grouping: "Grouping matching checksums",
  stagingRemovals: "Staging sprite removals",
  rewritingReferences: "Rewriting object references",
  rebuildingIndex: "Rebuilding the sprite usage index",
};

/** Counting sentence per unit, so a rewrite pass never reports sprites. */
const UNIT_COUNTERS: Record<string, string> = {
  sprites: "{processed} / {total} sprites",
  overrides: "{processed} / {total} edited sprites",
  objects: "{processed} / {total} objects",
  groups: "{processed} / {total} checksum groups",
  removals: "{processed} / {total} removals",
};

/** The placeholder shown between opening the dialog and the core's first event. */
const startingProgress = (status: string): OptimizationProgress => ({
  stage: "starting",
  status,
  unit: "sprites",
  stageIndex: 0,
  stageCount: 0,
  processed: 0,
  total: 0,
  stagePercent: 0,
  percent: 0,
  etaSeconds: null,
});

const newAnalysisId = () =>
  globalThis.crypto?.randomUUID?.() ?? `optimization-${Date.now()}-${Math.random()}`;
// Each mounted preview transfers a decoded RGBA sprite over Tauri IPC. Keep the
// number of canvases bounded even when an archive contains hundreds of thousands of duplicates.
const DUPLICATE_GROUP_PAGE_SIZE = 6;
const DUPLICATE_CANDIDATE_PAGE_SIZE = 24;
// Every card can be open at once, so the chip grid is capped per card instead of
// relying on the analysis preview limit alone.
const ID_CHIP_LIMIT = 48;

interface Operation {
  key: OperationKey;
  title: string;
  icon: LucideIcon;
  summary: string;
  count: number;
  unit: string;
  bytes: number;
  /** Extra line shown when the operation also touches objects. */
  references: number;
  detail: ReactNode;
}

export function OptimizeDialog({
  open,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: (message: string) => void;
}) {
  const t = useT();
  const [analysis, setAnalysis] = useState<OptimizationAnalysis | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [keepers, setKeepers] = useState<Record<string, number>>({});
  const [progress, setProgress] = useState<OptimizationProgress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [duplicatePage, setDuplicatePage] = useState(0);
  const [options, setOptions] = useState<OperationFlags>(noOperations);
  const [collapsed, setCollapsed] = useState<OperationFlags>(noOperations);
  const activeAnalysisId = useRef<string | null>(null);
  const setObjects = useProjectStore((state) => state.setObjects);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let started = false;
    setAnalysis(null);
    setConfirmed(false);
    setError("");
    setKeepers({});
    setDuplicatePage(0);
    setOptions(noOperations());
    setCollapsed(noOperations());
    setProgress(startingProgress(t("Preparing sprite analysis")));
    setCancelling(false);
    const analysisId = newAnalysisId();
    activeAnalysisId.current = analysisId;
    const channel = new Channel<OptimizationProgress>();
    channel.onmessage = (value) => {
      if (!cancelled) setProgress((current) => monotonicProgress(current, value));
    };
    const startTimer = window.setTimeout(
      () =>
        void (async () => {
          started = true;
          try {
            await flushCoreMutations();
            if (cancelled) return;
            const result = await invoke<OptimizationAnalysis>("analyze_optimization", {
              analysisId,
              onProgress: channel,
            });
            if (!cancelled && activeAnalysisId.current === analysisId) {
              activeAnalysisId.current = null;
              const findings = operationFindings(result);
              setAnalysis(result);
              // An operation with nothing to do starts off and folded away: the cards
              // that carry work are the ones asking to be read.
              setOptions(
                Object.fromEntries(
                  OPERATION_KEYS.map((key) => [key, findings[key] > 0]),
                ) as OperationFlags,
              );
              setCollapsed(
                Object.fromEntries(
                  OPERATION_KEYS.map((key) => [key, findings[key] === 0]),
                ) as OperationFlags,
              );
              setProgress(null);
            }
          } catch (reason) {
            if (!cancelled && activeAnalysisId.current === analysisId) {
              activeAnalysisId.current = null;
              setProgress(null);
              setError(String(reason));
              writeLog("ERROR", tr("Optimization analysis failed"), undefined, String(reason));
            }
          }
        })(),
      0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      // React StrictMode mounts effects twice in development. Deferring startup
      // prevents its disposable first effect from reaching Rust at all.
      if (started) void invoke("cancel_optimization", { analysisId }).catch(() => undefined);
    };
    // The dialog is seeded once per opening; a language change must not restart the analysis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const operations = useMemo(
    () =>
      analysis
        ? buildOperations(t, analysis, keepers, setKeepers, duplicatePage, setDuplicatePage)
        : [],
    [analysis, duplicatePage, keepers, t],
  );
  const optimize = async () => {
    if (!confirmed || busy || activeAnalysisId.current) return;
    const analysisId = newAnalysisId();
    activeAnalysisId.current = analysisId;
    setBusy(true);
    setError("");
    setProgress(startingProgress(t("Revalidating sprite checksums")));
    try {
      await flushCoreMutations();
      const channel = new Channel<OptimizationProgress>();
      channel.onmessage = (value) => setProgress((current) => monotonicProgress(current, value));
      const result = await invoke<OptimizationResult>("optimize_project", {
        request: {
          duplicateKeepers: keepers,
          optimizeDuplicates: options.duplicates,
          removeUnusedSprites: options.unused,
          removeUnusedOverrides: options.unusedOverrides,
          removeBlankSprites: options.blankSprites,
          dropRedundantOverrides: options.redundantOverrides,
          clearEmptyReferences: options.emptyReferences,
          repairInvalidReferences: options.invalidReferences,
        },
        analysisId,
        onProgress: channel,
      });
      const replacements = result.spriteReplacements;
      setObjects(
        useProjectStore.getState().objects.map((object) => {
          const replace = (id: number) => replacements[String(id)] ?? id;
          const frameGroups = object.frameGroups.map((group) => ({
            ...group,
            spriteIds: group.spriteIds.map(replace),
            frames: group.frames.map((frame) => ({ ...frame, spriteId: replace(frame.spriteId) })),
          }));
          return {
            ...object,
            spriteId: replace(object.spriteId),
            frameGroups,
            modified:
              Object.keys(replacements).some((id) =>
                object.frameGroups.some((group) => group.spriteIds.includes(Number(id))),
              ) || object.modified,
          };
        }),
      );
      onComplete(completionMessage(t, result));
      onOpenChange(false);
    } catch (reason) {
      setError(String(reason));
      writeLog("ERROR", tr("Optimization failed"), undefined, String(reason));
    } finally {
      activeAnalysisId.current = null;
      setBusy(false);
      setProgress(null);
    }
  };
  const analyzing = !analysis && !error;
  const selected = operations.filter((operation) => options[operation.key] && operation.count > 0);
  const actionable = operations.filter((operation) => operation.count > 0);
  const selectedBytes = selected.reduce((total, operation) => total + operation.bytes, 0);
  const selectedReferences = selected.reduce((total, operation) => total + operation.references, 0);
  const removedSprites = removedSpriteCount(analysis, options);
  const reductionPercent =
    analysis && analysis.statistics.total > 0
      ? (removedSprites * 100) / analysis.statistics.total
      : 0;
  const applyOptions = (next: OperationFlags) => {
    setOptions(next);
    setConfirmed(false);
  };
  const setOption = (key: OperationKey, value: boolean) =>
    applyOptions({ ...options, [key]: value });
  const preset = (keys: OperationKey[]) =>
    applyOptions(
      Object.fromEntries(
        OPERATION_KEYS.map((key) => [
          key,
          keys.includes(key) && operationCount(operations, key) > 0,
        ]),
      ) as OperationFlags,
    );
  const toggleBlock = (key: OperationKey) =>
    setCollapsed((current) => ({ ...current, [key]: !current[key] }));
  const setAllCollapsed = (value: boolean) =>
    setCollapsed(Object.fromEntries(OPERATION_KEYS.map((key) => [key, value])) as OperationFlags);
  const cancelActiveAnalysis = async () => {
    if (cancelling) return;
    setCancelling(true);
    setProgress((current) =>
      current ? { ...current, status: t("Cancelling analysis…"), etaSeconds: null } : current,
    );
    const analysisId = activeAnalysisId.current;
    try {
      if (analysisId) await invoke("cancel_optimization", { analysisId });
    } catch (reason) {
      writeLog(
        "WARNING",
        tr("Unable to signal optimization cancellation"),
        undefined,
        String(reason),
      );
    } finally {
      activeAnalysisId.current = null;
      setCancelling(false);
      onOpenChange(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && (busy || analyzing)) {
          void cancelActiveAnalysis();
        } else onOpenChange(next);
      }}
    >
      <DialogContent
        title={t("Optimize Project")}
        description={t(
          "Analyze first, review exact changes, then explicitly confirm safe cleanup.",
        )}
        className="optimize-dialog"
        overlayClassName="optimize-dialog-overlay"
      >
        {analyzing && <AnalysisProgress progress={progress} title={t("Analyzing sprites")} />}
        {analysis && (
          <div className="optimize-body">
            <section className="optimize-summary">
              <div className="optimize-summary-figure">
                <HardDrive size={17} />
                <span>
                  <em>{formatBytes(selectedBytes)}</em>
                  <small>{t("reclaimed on the next save")}</small>
                </span>
              </div>
              <div className="optimize-summary-meter">
                <span>
                  <strong>
                    {t("{count} sprites dropped", { count: removedSprites.toLocaleString() })}
                  </strong>
                  <em>{reductionPercent.toFixed(1)}%</em>
                </span>
                <Progress value={Math.min(100, reductionPercent)} />
                <small>
                  {actionable.length === 0
                    ? t("Nothing to optimize — every pass came back clean.")
                    : `${t(actionable.length === 1 ? "{selected} of {total} available operation selected" : "{selected} of {total} available operations selected", { selected: selected.length, total: actionable.length })} · ${selectedReferences > 0 ? t("{count} object references rewritten", { count: selectedReferences.toLocaleString() }) : t("no object is changed")}`}
                </small>
              </div>
            </section>
            <dl className="optimize-stats">
              <div>
                <dt>{t("Total sprites")}</dt>
                <dd>{analysis.statistics.total.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{t("Used")}</dt>
                <dd>{analysis.statistics.inUse.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{t("Unused")}</dt>
                <dd>
                  {analysis.statistics.unused.toLocaleString()}
                  <i>{analysis.estimatedReductionPercent.toFixed(1)}%</i>
                </dd>
              </div>
              <div>
                <dt>{t("Duplicated")}</dt>
                <dd>
                  {analysis.duplicateCandidateCount.toLocaleString()}
                  <i>
                    {t("{count} groups", { count: analysis.duplicateGroupCount.toLocaleString() })}
                  </i>
                </dd>
              </div>
              <div>
                <dt>{t("Blank")}</dt>
                <dd>{analysis.blankSpriteCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>{t("Broken refs")}</dt>
                <dd>
                  {(
                    analysis.statistics.invalidReferences + analysis.emptySlotCount
                  ).toLocaleString()}
                </dd>
              </div>
            </dl>
            <div className="optimize-note">
              <ShieldCheck size={15} />
              <span>
                <strong>{t("Nothing is written until you save")}</strong>
                <small>
                  {t(
                    "Every pass runs on the in-memory index in the Rust core: sprite removals are staged for the next SPR write and reference changes are undone by closing the project without saving.",
                  )}
                </small>
              </span>
            </div>
            <div className="optimize-toolbar">
              <div className="optimize-presets">
                <button type="button" onClick={() => preset([...OPERATION_KEYS])}>
                  {t("Everything")}
                </button>
                <button type="button" onClick={() => preset(STORAGE_ONLY_OPERATIONS)}>
                  {t("Storage only")}
                </button>
                <button type="button" onClick={() => preset([])}>
                  {t("None")}
                </button>
              </div>
              <div className="optimize-presets">
                <button type="button" onClick={() => setAllCollapsed(false)}>
                  {t("Expand all")}
                </button>
                <button type="button" onClick={() => setAllCollapsed(true)}>
                  {t("Collapse all")}
                </button>
              </div>
            </div>
            <div className="optimize-operations">
              {operations.map((operation) => (
                <OperationCard
                  key={operation.key}
                  operation={operation}
                  checked={options[operation.key]}
                  collapsed={collapsed[operation.key]}
                  onToggle={() => toggleBlock(operation.key)}
                  onCheckedChange={(value) => setOption(operation.key, value)}
                />
              ))}
            </div>
            <label className="optimize-confirm">
              <Switch
                checked={confirmed}
                disabled={selected.length === 0}
                onCheckedChange={setConfirmed}
              />
              <span>
                {t(
                  selected.length === 1
                    ? "I reviewed the enabled operation and confirm the sprite cleanup and reference changes listed above."
                    : "I reviewed the {count} enabled operations and confirm the sprite cleanup and reference changes listed above.",
                  { count: selected.length },
                )}
              </span>
            </label>
          </div>
        )}
        {error && (
          <div className="optimize-error">
            <AlertTriangle size={16} />
            {error}
          </div>
        )}
        {busy && (
          <div className="optimize-progress-overlay">
            <AnalysisProgress progress={progress} title={t("Applying optimization")} />
          </div>
        )}
        <footer className="dialog-footer">
          <Button
            variant="ghost"
            disabled={cancelling}
            onClick={() => {
              if (busy || analyzing) void cancelActiveAnalysis();
              else onOpenChange(false);
            }}
          >
            {cancelling ? t("Cancelling…") : t("Cancel")}
          </Button>
          <Button
            disabled={!analysis || !confirmed || busy || selected.length === 0}
            onClick={() => void optimize()}
          >
            {busy ? (
              t("Optimizing…")
            ) : (
              <>
                <CheckCircle2 size={13} />
                {selected.length === 1
                  ? t("Run 1 operation")
                  : t("Run {count} operations", { count: selected.length })}
              </>
            )}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function operationCount(operations: Operation[], key: OperationKey) {
  return operations.find((operation) => operation.key === key)?.count ?? 0;
}

/** Findings per operation, used before the cards exist to seed the switches. */
function operationFindings(analysis: OptimizationAnalysis): Record<OperationKey, number> {
  return {
    duplicates: analysis.duplicateGroupCount,
    blankSprites: analysis.blankSpriteCount,
    unused: analysis.unusedSourceCount,
    unusedOverrides: analysis.unusedOverrideCount,
    redundantOverrides: analysis.redundantOverrideCount,
    emptyReferences: analysis.emptySlotCount,
    invalidReferences: analysis.statistics.invalidReferences,
  };
}

/** Sprite IDs that stop existing, which is what the reduction percentage means. */
function removedSpriteCount(analysis: OptimizationAnalysis | null, options: OperationFlags) {
  if (!analysis) return 0;
  return (
    (options.unused ? analysis.unusedSourceCount : 0) +
    (options.unusedOverrides ? analysis.unusedOverrideCount : 0) +
    (options.blankSprites ? analysis.blankSpriteCount : 0) +
    (options.duplicates
      ? Math.max(0, analysis.duplicateCandidateCount - analysis.duplicateGroupCount)
      : 0)
  );
}

function buildOperations(
  t: Translate,
  analysis: OptimizationAnalysis,
  keepers: Record<string, number>,
  setKeepers: (update: (current: Record<string, number>) => Record<string, number>) => void,
  duplicatePage: number,
  setDuplicatePage: (page: number) => void,
): Operation[] {
  const visibleDuplicateGroups = analysis.duplicateGroups.slice(
    duplicatePage * DUPLICATE_GROUP_PAGE_SIZE,
    (duplicatePage + 1) * DUPLICATE_GROUP_PAGE_SIZE,
  );
  return [
    {
      key: "duplicates",
      title: t("Duplicate sprites"),
      icon: Copy,
      summary: t(
        "Sprites sharing decoded pixels are collapsed onto one keeper and every reference is redirected before removal.",
      ),
      count: analysis.duplicateGroupCount,
      unit: t(analysis.duplicateGroupCount === 1 ? "group" : "groups"),
      bytes: analysis.duplicateReclaimableBytes,
      references: analysis.duplicateCandidateCount - analysis.duplicateGroupCount,
      detail: analysis.duplicateGroups.length ? (
        <div className="duplicate-groups">
          {visibleDuplicateGroups.map((group) => (
            <DuplicateGroupReview
              key={group.checksum}
              group={group}
              keeper={keepers[group.checksum]}
              onKeeperChange={(id) =>
                setKeepers((current) => ({ ...current, [group.checksum]: id }))
              }
              onAutomatic={() =>
                setKeepers((current) => {
                  const next = { ...current };
                  delete next[group.checksum];
                  return next;
                })
              }
            />
          ))}
          <PageNavigation
            page={duplicatePage}
            totalItems={analysis.duplicateGroups.length}
            pageSize={DUPLICATE_GROUP_PAGE_SIZE}
            label="duplicate groups"
            onPageChange={setDuplicatePage}
          />
          {analysis.duplicateGroupCount > analysis.duplicateGroups.length && (
            <p className="optimize-hint">
              {t(
                "Showing the first {shown} groups of {total}. Groups outside the review sample keep their lowest ID.",
                {
                  shown: analysis.duplicateGroups.length.toLocaleString(),
                  total: analysis.duplicateGroupCount.toLocaleString(),
                },
              )}
            </p>
          )}
        </div>
      ) : (
        <p className="optimize-empty">{t("No sprites with identical content were found.")}</p>
      ),
    },
    {
      key: "blankSprites",
      title: t("Blank sprites"),
      icon: Ghost,
      summary: t(
        "Sprites that still occupy a block but decode to fully transparent pixels while objects point at them. The references are cleared and the pixels dropped.",
      ),
      count: analysis.blankSpriteCount,
      unit: t(analysis.blankSpriteCount === 1 ? "sprite" : "sprites"),
      bytes: analysis.blankReclaimableBytes,
      references: analysis.blankReferenceCount,
      detail: (
        <IdPreview
          ids={analysis.blankSpriteIds}
          total={analysis.blankSpriteCount}
          empty={t("No referenced sprite decodes to an empty image.")}
        />
      ),
    },
    {
      key: "unused",
      title: t("Unused source sprites"),
      icon: Trash2,
      summary: t(
        "Sprites in the SPR that no object references. They are dropped from the archive the next time it is written.",
      ),
      count: analysis.unusedSourceCount,
      unit: t(analysis.unusedSourceCount === 1 ? "sprite" : "sprites"),
      bytes: analysis.unusedSourceReclaimableBytes,
      references: 0,
      detail: (
        <IdPreview
          ids={analysis.unusedSourcePreview}
          total={analysis.unusedSourceCount}
          empty={t("No unused source sprites.")}
          thumbnails
        />
      ),
    },
    {
      key: "unusedOverrides",
      title: t("Unused sprite overrides"),
      icon: Layers,
      summary: t(
        "Imported or edited sprites that no object ended up using. Dropping them frees the decoded buffer they hold.",
      ),
      count: analysis.unusedOverrideCount,
      unit: t(analysis.unusedOverrideCount === 1 ? "override" : "overrides"),
      bytes: analysis.reclaimableBytes,
      references: 0,
      detail: (
        <IdPreview
          ids={analysis.unusedOverrideIds}
          total={analysis.unusedOverrideCount}
          empty={t("No unused overrides.")}
          thumbnails
        />
      ),
    },
    {
      key: "redundantOverrides",
      title: t("Redundant overrides"),
      icon: CopyMinus,
      summary: t(
        "Overrides whose pixels are identical to the SPR sprite they shadow. Dropping them re-exposes the original block and skips a re-encode on save.",
      ),
      count: analysis.redundantOverrideCount,
      unit: t(analysis.redundantOverrideCount === 1 ? "override" : "overrides"),
      bytes: analysis.redundantOverrideBytes,
      references: 0,
      detail: (
        <IdPreview
          ids={analysis.redundantOverrideIds}
          total={analysis.redundantOverrideCount}
          empty={t("Every override differs from its source sprite.")}
          thumbnails
        />
      ),
    },
    {
      key: "emptyReferences",
      title: t("Empty sprite slots"),
      icon: PackageX,
      summary: t(
        "References to IDs inside the archive whose slot holds no sprite block at all. They draw nothing and are cleared to 0.",
      ),
      count: analysis.emptySlotCount,
      unit: t(analysis.emptySlotCount === 1 ? "slot" : "slots"),
      bytes: 0,
      references: analysis.emptySlotReferenceCount,
      detail: (
        <IdPreview
          ids={analysis.emptySlotIds}
          total={analysis.emptySlotCount}
          empty={t("Every referenced slot carries sprite data.")}
        />
      ),
    },
    {
      key: "invalidReferences",
      title: t("Invalid references"),
      icon: Link2Off,
      summary: t(
        "References pointing past the end of the archive. Nothing can resolve them, so they are cleared to 0.",
      ),
      count: analysis.statistics.invalidReferences,
      unit: t(analysis.statistics.invalidReferences === 1 ? "reference" : "references"),
      bytes: 0,
      references: analysis.statistics.invalidReferences,
      detail: (
        <IdPreview
          ids={analysis.invalidReferencePreview}
          total={analysis.statistics.invalidReferences}
          empty={t("No invalid references.")}
        />
      ),
    },
  ];
}

function completionMessage(t: Translate, result: OptimizationResult) {
  const removals = [
    [result.removedDuplicates, "duplicates"],
    [result.removedUnusedSprites, "unused sprites"],
    [result.removedBlankSprites, "blank sprites"],
    [result.removedOverrides, "unused overrides"],
    [result.droppedRedundantOverrides, "redundant overrides"],
  ] as const;
  const references = [
    [result.remappedReferences, "redirected"],
    [result.clearedBlankReferences, "blank"],
    [result.clearedEmptyReferences, "empty"],
    [result.repairedInvalidReferences, "invalid"],
  ] as const;
  const removed = removals
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count.toLocaleString()} ${t(label)}`);
  const changed = references
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count.toLocaleString()} ${t(label)}`);
  const parts = [
    removed.length ? t("removed {list}", { list: removed.join(", ") }) : t("removed nothing"),
    changed.length ? t("{list} references updated", { list: changed.join(", ") }) : "",
  ].filter(Boolean);
  return t("Optimization completed: {summary} ({bytes} reclaimed on save)", {
    summary: parts.join("; "),
    bytes: formatBytes(result.reclaimedBytes),
  });
}

function OperationCard({
  operation,
  checked,
  collapsed,
  onToggle,
  onCheckedChange,
}: {
  operation: Operation;
  checked: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onCheckedChange: (checked: boolean) => void;
}) {
  const t = useT();
  const Icon = operation.icon;
  const empty = operation.count === 0;
  return (
    <section className={`optimize-option ${empty ? "clean" : ""} ${checked ? "" : "disabled"}`}>
      <header className="optimize-option-header">
        <button
          className="optimize-option-collapse"
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <Icon size={15} className="optimize-option-icon" />
          <span>
            <strong>
              {operation.title}
              <b className="optimize-badge">
                {empty ? t("Clean") : `${operation.count.toLocaleString()} ${operation.unit}`}
              </b>
            </strong>
            <small>{operation.summary}</small>
          </span>
        </button>
        <div className="optimize-option-aside">
          {operation.bytes > 0 && (
            <span className="optimize-option-bytes">{formatBytes(operation.bytes)}</span>
          )}
          {operation.references > 0 && (
            <span className="optimize-option-tag">{t("rewrites objects")}</span>
          )}
          <Switch
            checked={checked}
            disabled={empty}
            onCheckedChange={onCheckedChange}
            aria-label={operation.title}
          />
        </div>
      </header>
      {!collapsed && <div className="optimize-option-body">{operation.detail}</div>}
    </section>
  );
}

function IdPreview({
  ids,
  total,
  empty,
  thumbnails = false,
}: {
  ids: number[];
  total: number;
  empty: string;
  thumbnails?: boolean;
}) {
  const t = useT();
  if (!total) return <p className="optimize-empty">{empty}</p>;
  const visible = ids.slice(0, ID_CHIP_LIMIT);
  return (
    <div className="optimize-ids">
      <div className={`optimize-id-grid ${thumbnails ? "with-thumbnails" : ""}`}>
        {visible.map((id) => (
          <span key={id} className="optimize-id">
            {thumbnails && <SpritePreview spriteId={id} size={26} />}
            <code>#{id}</code>
          </span>
        ))}
      </div>
      {total > visible.length && (
        <p className="optimize-hint">
          {t("Showing {shown} of {total} IDs. The operation applies to all of them.", {
            shown: visible.length.toLocaleString(),
            total: total.toLocaleString(),
          })}
        </p>
      )}
    </div>
  );
}

function DuplicateGroupReview({
  group,
  keeper,
  onKeeperChange,
  onAutomatic,
}: {
  group: DuplicateGroup;
  keeper?: number;
  onKeeperChange: (id: number) => void;
  onAutomatic: () => void;
}) {
  const t = useT();
  const [page, setPage] = useState(0);
  const selectedId = keeper ?? group.sprites[0].id;
  const selected = group.sprites.find((sprite) => sprite.id === selectedId) ?? group.sprites[0];
  const visibleCandidates = group.sprites.slice(
    page * DUPLICATE_CANDIDATE_PAGE_SIZE,
    (page + 1) * DUPLICATE_CANDIDATE_PAGE_SIZE,
  );
  return (
    <article>
      <div className="duplicate-group-heading">
        <SpritePreview spriteId={selected.id} size={42} />
        <span>
          <span>
            {t("Checksum")} <code>{group.checksum}</code>
          </span>
          <small>
            {t("{count} identical IDs · keeping #{id}", {
              count: (group.spriteCount ?? group.sprites.length).toLocaleString(),
              id: selected.id,
            })}
          </small>
        </span>
      </div>
      <div className="duplicate-candidates">
        {visibleCandidates.map((sprite) => (
          <label key={sprite.id} className={selectedId === sprite.id ? "selected" : ""}>
            <input
              type="radio"
              name={`keeper-${group.checksum}`}
              checked={selectedId === sprite.id}
              onChange={() => onKeeperChange(sprite.id)}
            />
            <span>
              <strong>#{sprite.id}</strong>
              <small>
                {sprite.origin} · {sprite.usageCount}{" "}
                {t(sprite.usageCount === 1 ? "object" : "objects")}
              </small>
              <small>{formatBytes(sprite.storageBytes)}</small>
            </span>
          </label>
        ))}
      </div>
      <div className="duplicate-group-actions">
        <button className="duplicate-auto" onClick={onAutomatic}>
          {t("Automatic: keep first ID")}
        </button>
        <PageNavigation
          page={page}
          totalItems={group.sprites.length}
          pageSize={DUPLICATE_CANDIDATE_PAGE_SIZE}
          label="candidates"
          onPageChange={setPage}
        />
      </div>
    </article>
  );
}

function PageNavigation({
  page,
  totalItems,
  pageSize,
  label,
  onPageChange,
}: {
  page: number;
  totalItems: number;
  pageSize: number;
  label: string;
  onPageChange: (page: number) => void;
}) {
  const t = useT();
  const translatedLabel = t(label);
  const pageCount = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  if (pageCount <= 1) return null;
  return (
    <nav
      className="duplicate-pagination"
      aria-label={t("{label} pagination", { label: translatedLabel })}
    >
      <Button
        variant="ghost"
        size="icon"
        disabled={safePage === 0}
        onClick={() => onPageChange(safePage - 1)}
        aria-label={t("Previous {label} page", { label: translatedLabel })}
      >
        <ChevronLeft size={13} />
      </Button>
      <span>
        {safePage + 1} / {pageCount}
      </span>
      <Button
        variant="ghost"
        size="icon"
        disabled={safePage + 1 >= pageCount}
        onClick={() => onPageChange(safePage + 1)}
        aria-label={t("Next {label} page", { label: translatedLabel })}
      >
        <ChevronRight size={13} />
      </Button>
    </nav>
  );
}

function AnalysisProgress({
  progress,
  title,
}: {
  progress: OptimizationProgress | null;
  title: string;
}) {
  const t = useT();
  const percent = clampPercent(progress?.percent);
  const stagePercent = clampPercent(progress?.stagePercent);
  // The core names the stage; the sentence it also sends only covers a stage
  // this build does not know yet.
  const label = progress?.stage
    ? t(STAGE_LABELS[progress.stage] ?? progress.status ?? "Preparing analysis")
    : t("Preparing analysis");
  return (
    <div className="optimization-analysis-progress" role="status" aria-live="polite">
      <div className="optimization-scan" aria-hidden="true">
        <Radar size={31} />
        <div className="scan-cells">
          {Array.from({ length: 12 }, (_, index) => (
            <i key={index} style={{ animationDelay: `${index * 70}ms` }} />
          ))}
        </div>
        <b />
      </div>
      <div className="optimization-progress-copy">
        <span>
          <strong>{title}</strong>
          <em>{Math.round(percent)}%</em>
        </span>
        <small className="optimization-stage-line">
          <span>{label}</span>
          {progress?.stageCount ? (
            <i>
              {t("Step {index} of {total}", {
                index: progress.stageIndex,
                total: progress.stageCount,
              })}
            </i>
          ) : null}
        </small>
        <Progress value={percent} />
        {/* The stage bar is what moves while the overall one crawls through a
            long pass — without it a decode of 200k sprites looks frozen. */}
        <Progress className="optimization-stage-meter" value={stagePercent} />
        <footer>
          <span>{stageCounter(t, progress)}</span>
          <span>{formatEta(t, progress?.etaSeconds)}</span>
        </footer>
      </div>
    </div>
  );
}

function clampPercent(percent?: number) {
  return Math.max(0, Math.min(100, percent ?? 0));
}

function stageCounter(t: Translate, progress: OptimizationProgress | null) {
  if (!progress?.total) return t("Reading sprite index…");
  return t(UNIT_COUNTERS[progress.unit] ?? UNIT_COUNTERS.sprites, {
    processed: progress.processed.toLocaleString(),
    total: progress.total.toLocaleString(),
  });
}

function formatEta(t: Translate, seconds?: number | null) {
  if (seconds === null || seconds === undefined) return t("Calculating ETA…");
  if (seconds < 1) return t("Finishing…");
  if (seconds < 60) return t("ETA {seconds}s", { seconds });
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60),
      remaining = seconds % 60;
    return t("ETA {minutes}m {seconds}s", { minutes, seconds: remaining });
  }
  // A first scan of a large archive on a cold cache passes the hour mark, and
  // "ETA 74m" is a number nobody reads as time.
  return t("ETA {hours}h {minutes}m", {
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
