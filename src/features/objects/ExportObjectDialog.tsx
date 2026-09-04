import { FileArchive, Image, Images } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import type { ThingObject } from "../../types/editor";
import { useT } from "../../lib/i18n";

export type ObjectExportFormat = "obd" | "png" | "spritesheet";

export function ExportObjectDialog({
  open,
  onOpenChange,
  object,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  object: ThingObject | null;
  onSelect: (format: ObjectExportFormat) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("Export Object")}
        description={
          object
            ? `${t(object.kind)} #${object.id} · ${object.name}`
            : t("Select an object before exporting.")
        }
        className="format-choice-dialog"
      >
        <div className="format-choice-grid three">
          <button disabled={!object} onClick={() => onSelect("obd")}>
            <FileArchive size={22} />
            <span>
              <strong>OBD</strong>
              <small>
                {t("Lossless object metadata, layouts, frames and referenced sprites.")}
              </small>
            </span>
          </button>
          <button disabled={!object} onClick={() => onSelect("png")}>
            <Image size={22} />
            <span>
              <strong>PNG</strong>
              <small>{t("Rendered image of the currently selected frame.")}</small>
            </span>
          </button>
          <button disabled={!object} onClick={() => onSelect("spritesheet")}>
            <Images size={22} />
            <span>
              <strong>{t("Spritesheet")}</strong>
              <small>{t("Rendered sheet containing all supported frames and patterns.")}</small>
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
