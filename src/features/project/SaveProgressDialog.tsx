import { CheckCircle2, Clipboard, LoaderCircle, XCircle } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { Progress } from "../../components/ui/progress";
import { useT } from "../../lib/i18n";

export interface SaveProgress {
  stage: string;
  status: string;
  percent: number;
  objectsProcessed: number;
  objectsTotal: number;
  spritesProcessed: number;
  spritesTotal: number;
  complete: boolean;
}

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

export function SaveProgressDialog({
  progress,
  error,
  onClose,
}: {
  progress: SaveProgress | null;
  error: string | null;
  onClose: () => void;
}) {
  const t = useT();
  const open = progress !== null;
  const finished = Boolean(progress?.complete || error);
  const failure = error ? parseSaveError(error) : null;
  const clientSave =
    ["dat", "spr"].includes(progress?.stage ?? "") ||
    /DAT\/SPR|SPR archive|sprite overrides/i.test(progress?.status ?? "");
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
            <strong>{error ? t("Unable to write the project") : progress?.status}</strong>
            <span>{Math.round(progress?.percent ?? 0)}%</span>
          </div>
          <Progress value={progress?.percent ?? 0} />
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
              <dt>{t("Stage")}</dt>
              <dd>{progress?.stage}</dd>
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
