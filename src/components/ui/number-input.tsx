import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { useT } from "../../lib/i18n";

interface NumberInputProps {
  value: number;
  onCommit: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  shiftStep?: number;
  suffix?: string;
  ariaLabel?: string;
  className?: string;
  dataFrameDuration?: number;
}

export function NumberInput({
  value,
  onCommit,
  min,
  max,
  step = 1,
  shiftStep = step * 10,
  suffix,
  ariaLabel,
  className,
  dataFrameDuration,
}: NumberInputProps) {
  const t = useT();
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = (candidate = draft) => {
    const parsed = Number(candidate);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.max(min, Math.min(max, Math.round(parsed)));
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  const bump = (amount: number) => {
    const parsed = Number(draft);
    commit(String((Number.isFinite(parsed) ? parsed : value) + amount));
  };

  return (
    <span className={cn("number-input", className)}>
      <span className="number-input-value">
        <input
          data-frame-duration={dataFrameDuration}
          aria-label={ariaLabel}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => commit()}
          onWheel={(event) => event.currentTarget.blur()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            else if (event.key === "Escape") {
              setDraft(String(value));
              event.currentTarget.blur();
            } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              bump((event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? shiftStep : step));
            }
          }}
        />
        {suffix && <i>{suffix}</i>}
      </span>
      <span className="number-input-steppers">
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("Increase {label}", { label: ariaLabel ?? t("value") })}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => bump(step)}
        >
          <ChevronUp size={10} />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={t("Decrease {label}", { label: ariaLabel ?? t("value") })}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => bump(-step)}
        >
          <ChevronDown size={10} />
        </button>
      </span>
    </span>
  );
}
