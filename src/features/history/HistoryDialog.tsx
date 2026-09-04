import { Brush, History, Layers, Redo2, Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Tooltip } from "../../components/ui/tooltip";
import { useT } from "../../lib/i18n";
import { useHistoryStore } from "../../stores/history-store";

/**
 * The recorded edits, oldest first, with the session's opening state as the first row.
 * `past` is what has been applied and `future` what was undone, so the two stacks read as
 * one timeline whose cursor sits at `past.length` — a row above the cursor is a step back,
 * one below it a step forward.
 */
export function HistoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const past = useHistoryStore((state) => state.past);
  const future = useHistoryStore((state) => state.future);
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);
  const jumpTo = useHistoryStore((state) => state.jumpTo);
  const reset = useHistoryStore((state) => state.reset);
  const currentRef = useRef<HTMLButtonElement>(null);
  const steps = [...past, ...future];
  const cursor = past.length;
  // Travelling far enough leaves the current step off screen; the list is only useful if the
  // row it is pointing at is the one you can see.
  useEffect(() => {
    if (open) currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [cursor, open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("Change history")}
        description={t("Every recorded edit of this session. Select a step to travel to it.")}
        className="history-dialog"
      >
        <div className="history-toolbar">
          <span className="history-count">
            <History size={13} />
            {t("{count} steps", { count: steps.length })}
            {future.length > 0 && <em>{t("{count} undone", { count: future.length })}</em>}
          </span>
          <Tooltip
            label={t("Undo")}
            description={t("Restores the object state before the latest edit.")}
            shortcut="Ctrl+Z"
          >
            <Button variant="ghost" size="icon" disabled={!past.length} onClick={undo}>
              <Undo2 size={14} />
            </Button>
          </Tooltip>
          <Tooltip
            label={t("Redo")}
            description={t("Reapplies the most recently undone object edit.")}
            shortcut="Ctrl+Shift+Z"
          >
            <Button variant="ghost" size="icon" disabled={!future.length} onClick={redo}>
              <Redo2 size={14} />
            </Button>
          </Tooltip>
          <Tooltip
            label={t("Clear history")}
            description={t(
              "Drops the recorded steps and keeps the project exactly as it is now. The edits themselves are not reverted.",
            )}
          >
            <Button variant="ghost" size="icon" disabled={!steps.length} onClick={reset}>
              <Trash2 size={14} />
            </Button>
          </Tooltip>
        </div>
        <ScrollArea className="history-scroll">
          <div className="history-list">
            <button
              ref={cursor === 0 ? currentRef : undefined}
              className={`history-step base ${cursor === 0 ? "current" : ""}`}
              onClick={() => jumpTo(0)}
            >
              <i>
                <History size={13} />
              </i>
              <span>
                <strong>{t("Opening state")}</strong>
                <small>{t("Before the first recorded edit of this session.")}</small>
              </span>
            </button>
            {steps.map((step, index) => {
              const position = index + 1;
              const isCurrent = position === cursor;
              return (
                <button
                  key={step.id}
                  ref={isCurrent ? currentRef : undefined}
                  className={`history-step ${isCurrent ? "current" : ""} ${
                    position > cursor ? "undone" : ""
                  }`}
                  onClick={() => jumpTo(position)}
                >
                  <i>{step.kind === "pixels" ? <Brush size={13} /> : <Layers size={13} />}</i>
                  <span>
                    <strong>{step.label}</strong>
                    {step.context && <small>{step.context}</small>}
                  </span>
                  <time>
                    {new Date(step.timestamp).toLocaleTimeString([], { hour12: false })}
                  </time>
                </button>
              );
            })}
          </div>
        </ScrollArea>
        <footer className="dialog-footer">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Close")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
