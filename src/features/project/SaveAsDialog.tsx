import { Braces, Database, Scissors } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { NumberInput } from "../../components/ui/number-input";
import { RadioGroup, RadioGroupItem } from "../../components/ui/radio-group";
import { useT } from "../../lib/i18n";
import { SETTINGS_LIMITS, SPR_SPLIT_PRESETS } from "../../stores/settings-store";

export type SaveAsFormat = "client" | "json";


export function SaveAsDialog({
  open,
  onOpenChange,
  canSaveClient,
  splitSize,
  onSplitSizeChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canSaveClient: boolean;
  splitSize: number;
  onSplitSizeChange: (value: number) => void;
  onSelect: (format: SaveAsFormat) => void;
}) {
  const t = useT();
  const [step, setStep] = useState<"format" | "split">("format");
  const [customDraft, setCustomDraft] = useState(
    splitSize > 0 && !SPR_SPLIT_PRESETS.includes(splitSize as (typeof SPR_SPLIT_PRESETS)[number])
      ? splitSize
      : 256,
  );
  const custom =
    splitSize > 0 && !SPR_SPLIT_PRESETS.includes(splitSize as (typeof SPR_SPLIT_PRESETS)[number]);
  const selection = splitSize === 0 ? "none" : custom ? "custom" : String(splitSize);
  const close = (next: boolean) => {
    // The step is per-visit: reopening Save As always starts on the format choice.
    if (!next) setStep("format");
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title={step === "split" ? t("SPR volumes") : t("Save As")}
        description={
          step === "split"
            ? t("The complete SPR is always written; volumes are published next to it.")
            : t("Choose the output format before selecting its destination.")
        }
        className="format-choice-dialog"
      >
        {step === "format" ? (
          <div className="format-choice-grid">
            <button disabled={!canSaveClient} onClick={() => setStep("split")}>
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
        ) : (
          <div className="split-options">
            <RadioGroup
              value={selection}
              onValueChange={(value) => {
                if (value === "none") onSplitSizeChange(0);
                else if (value === "custom") onSplitSizeChange(customDraft);
                else onSplitSizeChange(Number(value));
              }}
            >
              <label className="split-option">
                <RadioGroupItem value="none" />
                <span>
                  <strong>{t("Single archive")}</strong>
                  <small>{t("Writes only the complete SPR file.")}</small>
                </span>
              </label>
              {SPR_SPLIT_PRESETS.map((size) => (
                <label className="split-option" key={size}>
                  <RadioGroupItem value={String(size)} />
                  <span>
                    <strong>{t("{size} MB per volume", { size })}</strong>
                    <small>{t("Numbered .001, .002, … next to the archive.")}</small>
                  </span>
                </label>
              ))}
              <label className="split-option">
                <RadioGroupItem value="custom" />
                <span>
                  <strong>{t("Custom size")}</strong>
                  <small>
                    {t("Between {min} and {max} MB per volume.", {
                      min: SETTINGS_LIMITS.sprSplitSize.min,
                      max: SETTINGS_LIMITS.sprSplitSize.max,
                    })}
                  </small>
                </span>
                <NumberInput
                  value={custom ? splitSize : customDraft}
                  min={SETTINGS_LIMITS.sprSplitSize.min}
                  max={SETTINGS_LIMITS.sprSplitSize.max}
                  step={16}
                  shiftStep={128}
                  suffix="MB"
                  ariaLabel={t("Custom size")}
                  onCommit={(value) => {
                    setCustomDraft(value);
                    onSplitSizeChange(value);
                  }}
                />
              </label>
            </RadioGroup>
            <p className="split-note">
              <Scissors size={12} />
              {t(
                "Volumes are byte ranges of the archive: a client directory that only has them is joined back when the project is opened.",
              )}
            </p>
          </div>
        )}
        <footer className="dialog-footer">
          {step === "split" && (
            <Button variant="ghost" onClick={() => setStep("format")}>
              {t("Back")}
            </Button>
          )}
          <Button variant="ghost" onClick={() => close(false)}>
            {t("Cancel")}
          </Button>
          {step === "split" && (
            <Button
              onClick={() => {
                setStep("format");
                onSelect("client");
              }}
            >
              {t("Choose destination")}
            </Button>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
