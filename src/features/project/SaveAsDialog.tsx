import { Braces, Database } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { useT } from "../../lib/i18n";

export type SaveAsFormat = "client" | "json";

export function SaveAsDialog({
  open,
  onOpenChange,
  canSaveClient,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canSaveClient: boolean;
  onSelect: (format: SaveAsFormat) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("Save As")}
        description={t("Choose the output format before selecting its destination.")}
        className="format-choice-dialog"
      >
        <div className="format-choice-grid">
          <button disabled={!canSaveClient} onClick={() => onSelect("client")}>
            <Database size={22} />
            <span>
              <strong>{t("Client DAT/SPR")}</strong>
              <small>{t("Writes a version-aware DAT, SPR archive and matching OTFI file.")}</small>
              {!canSaveClient && <em>{t("Load a client SPR source first.")}</em>}
            </span>
          </button>
          <button onClick={() => onSelect("json")}>
            <Braces size={22} />
            <span>
              <strong>{t("Project JSON")}</strong>
              <small>{t("Stores the editable workspace and imported sprite overrides.")}</small>
            </span>
          </button>
        </div>
        <footer className="dialog-footer">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
