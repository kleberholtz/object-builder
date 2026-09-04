import { Check, CheckCircle2, Clipboard, LoaderCircle, XCircle } from "lucide-react";
import { useRef } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { Progress } from "../../components/ui/progress";
import { useT } from "../../lib/i18n";
import type { SaveAsFormat } from "./SaveAsDialog";

export interface SaveProgress {
  stage: string;
  status: string;
  detail: string | null;
  percent: number;
  objectsProcessed: number;
  objectsTotal: number;
  spritesProcessed: number;
  spritesTotal: number;
  bytesWritten: number;
  bytesTotal: number;
  volumes: number;
  elapsedMs: number;
  complete: boolean;
}

const clientStages = ["preparing", "dat", "spr", "otfi", "volumes", "indexing", "completed"];
const manifestStages = ["preparing", "objects", "sprites", "writing", "validating", "completed"];

const stageLabels: Record<string, string> = {
  preparing: "Collecting changes",
  dat: "DAT metadata",
  spr: "SPR archive",
  otfi: "OTFI features",
  volumes: "SPR volumes",
  indexing: "Sprite index",
  objects: "Objects",
  sprites: "Sprite overrides",
  writing: "Project file",
  validating: "Verification",
  completed: "Finished",
};

function parseSaveError(value: string) {
  try {
    const parsed = JSON.parse(value) as { kind?: string; message?: unknown };
    if (parsed.kind === "operation" && parsed.message && typeof parsed.message === "object") {
      return parsed.message as {
        file?: string;
        operation?: string;
        reason?: string;
        suggestion?: string;
      };
    }
  } catch {}
  return { reason: value };
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

function formatDuration(milliseconds: number) {
  const seconds = milliseconds / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
}

function useStageTimings(progress: SaveProgress | null) {
  const timings = useRef(new Map<string, { start: number; end?: number }>());
  const previous = useRef(0);
  if (!progress) {
    timings.current.clear();
    previous.current = 0;
    return timings.current;
  }
  if (progress.elapsedMs < previous.current) timings.current.clear();
  previous.current = progress.elapsedMs;
  for (const [stage, entry] of timings.current) {
    if (stage !== progress.stage && entry.end === undefined) entry.end = progress.elapsedMs;
  }
  if (!timings.current.has(progress.stage))
    timings.current.set(progress.stage, { start: progress.elapsedMs });
  if (progress.complete) {
    const current = timings.current.get(progress.stage);
    if (current) current.end = progress.elapsedMs;
  }
  return timings.current;
}

export function SaveProgressDialog({
  progress,
  error,
  format,
  splitSize,
  onClose,
}: {
  progress: SaveProgress | null;
  error: string | null;
  format: SaveAsFormat | null;
  splitSize: number;
  onClose: () => void;
}) {
  const t = useT();
  const open = progress !== null;
  const finished = Boolean(progress?.complete || error);
  const failure = error ? parseSaveError(error) : null;
  const timings = useStageTimings(progress);
  const clientSave = format === "client";
  const stages = (clientSave ? clientStages : manifestStages).filter(
    (stage) => stage !== "volumes" || splitSize > 0 || (progress?.volumes ?? 0) > 0,
  );
  const currentIndex = stages.indexOf(progress?.stage ?? "");
  const elapsed = progress?.elapsedMs ?? 0;
  const written = progress?.bytesWritten ?? 0;
  // Throughput is only honest once a stage has actually written something for a while.
  const rate = elapsed > 500 && written > 0 ? (written / elapsed) * 1000 : 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && finished) onClose();
      }}
    >
      <DialogContent
        title={
          error
            ? t("Save failed")
            : progress?.complete
              ? t("Save completed successfully")
              : clientSave
                ? t("Saving Client DAT/SPR")
                : t("Saving Project JSON")
        }
        description={
          finished
            ? t("The save operation has finished.")
            : t("Please wait while the files are written safely in the background.")
        }
        className="save-dialog"
      >
        <div className="save-progress-body">
          <div
            className={`save-state-icon ${error ? "error" : progress?.complete ? "success" : "working"}`}
          >
            {error ? (
              <XCircle size={22} />
            ) : progress?.complete ? (
              <CheckCircle2 size={22} />
            ) : (
              <LoaderCircle size={22} />
            )}
          </div>
          <div className="save-state">
            <strong>{error ? t("Unable to write the project") : t(progress?.status ?? "")}</strong>
            <span>{Math.round(progress?.percent ?? 0)}%</span>
          </div>
          <Progress value={progress?.percent ?? 0} />
          {progress?.detail && !error && (
            <p className="save-detail" title={progress.detail}>
              {progress.detail}
            </p>
          )}
          <ol className="save-steps">
            {stages.map((stage, index) => {
              const timing = timings.get(stage);
              const done = error ? false : currentIndex > index || Boolean(progress?.complete);
              const active = !error && currentIndex === index && !progress?.complete;
              const duration =
                timing?.end !== undefined ? formatDuration(timing.end - timing.start) : null;
              return (
                <li key={stage} className={done ? "done" : active ? "active" : "pending"}>
                  <i>
                    {done ? (
                      <Check size={11} />
                    ) : active ? (
                      <LoaderCircle size={11} className="save-step-spinner" />
                    ) : null}
                  </i>
                  <span>{t(stageLabels[stage] ?? stage)}</span>
                  {duration && <em>{duration}</em>}
                </li>
              );
            })}
          </ol>
          <dl>
            <div>
              <dt>{t("Objects")}</dt>
              <dd>
                {(progress?.objectsProcessed ?? 0).toLocaleString()} /{" "}
                {(progress?.objectsTotal ?? 0).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>{t("Sprite overrides")}</dt>
              <dd>
                {(progress?.spritesProcessed ?? 0).toLocaleString()} /{" "}
                {(progress?.spritesTotal ?? 0).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt>{t("Written")}</dt>
              <dd>
                {formatBytes(written)}
                {rate > 0 && ` · ${formatBytes(rate)}/s`}
              </dd>
            </div>
            {(splitSize > 0 || (progress?.volumes ?? 0) > 0) && (
              <div>
                <dt>{t("Volumes")}</dt>
                <dd>
                  {progress?.complete
                    ? t("{count} × up to {size} MB", {
                        count: progress?.volumes ?? 0,
                        size: splitSize,
                      })
                    : t("{size} MB each", { size: splitSize })}
                </dd>
              </div>
            )}
            <div>
              <dt>{t("Elapsed")}</dt>
              <dd>{formatDuration(elapsed)}</dd>
            </div>
          </dl>
          {error && failure && (
            <div className="save-error">
              {failure.operation && (
                <>
                  <b>{t("Operation")}</b>
                  <span>{failure.operation}</span>
                </>
              )}
              {failure.file && (
                <>
                  <b>{t("Unable to write")}</b>
                  <code>{failure.file}</code>
                </>
              )}
              <b>{t("Reason")}</b>
              <span>{failure.reason}</span>
              {failure.suggestion && (
                <details>
                  <summary>{t("Show details")}</summary>
                  <p>{failure.suggestion}</p>
                </details>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void navigator.clipboard.writeText(error)}
              >
                <Clipboard size={12} />
                {t("Copy details")}
              </Button>
            </div>
          )}
        </div>
        <footer className="dialog-footer">
          <Button disabled={!finished} onClick={onClose}>
            {finished ? t("Close") : t("Saving…")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
