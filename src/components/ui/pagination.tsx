import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "./button";
import { Select } from "./select";
import { useT } from "../../lib/i18n";

export const PAGE_SIZES = [25, 50, 100, 250, 500];
const sizeEvent = "object-builder-page-size";

export function usePersistentPageSize(storageKey = "object-builder-page-size", defaultValue = 100) {
  const [pageSize, setPageSizeState] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey));
    return PAGE_SIZES.includes(stored) ? stored : defaultValue;
  });
  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: number }>).detail;
      if (detail?.key === storageKey) setPageSizeState(detail.value);
    };
    window.addEventListener(sizeEvent, update);
    return () => window.removeEventListener(sizeEvent, update);
  }, [storageKey]);
  const setPageSize = (value: number) => {
    if (!PAGE_SIZES.includes(value)) return;
    localStorage.setItem(storageKey, String(value));
    setPageSizeState(value);
    window.dispatchEvent(new CustomEvent(sizeEvent, { detail: { key: storageKey, value } }));
  };
  return [pageSize, setPageSize] as const;
}

export function Pagination({
  page,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  label = "items",
}: {
  page: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  label?: string;
}) {
  const t = useT();
  const translatedLabel = t(label);
  const pages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(page, pages - 1);
  useEffect(() => {
    if (page !== safePage) onPageChange(safePage);
  }, [onPageChange, page, safePage]);
  const values = useMemo(() => {
    const candidates = new Set([0, pages - 1, safePage - 1, safePage, safePage + 1]);
    return [...candidates].filter((value) => value >= 0 && value < pages).sort((a, b) => a - b);
  }, [pages, safePage]);
  return (
    <div className="pagination">
      <div className="pagination-summary">
        <span className="pagination-total">
          {t("{count} {label}", { count: totalItems.toLocaleString(), label: translatedLabel })}
        </span>
        <span className="pagination-current">
          {t("Page {page} of {pages}", { page: safePage + 1, pages })}
        </span>
        <div className="page-size">
          <span>{t("Per page")}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
            options={PAGE_SIZES.map((value) => ({ value: String(value), label: String(value) }))}
            ariaLabel={t("{label} per page", { label: translatedLabel })}
          />
        </div>
      </div>
      <nav
        className="page-controls"
        aria-label={t("{label} pagination", { label: translatedLabel })}
      >
        <Button
          className="page-jump"
          variant="ghost"
          size="icon"
          disabled={safePage === 0}
          onClick={() => onPageChange(0)}
          aria-label={t("First page")}
          title={t("First page")}
        >
          <ChevronsLeft size={13} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={safePage === 0}
          onClick={() => onPageChange(safePage - 1)}
          aria-label={t("Previous page")}
          title={t("Previous page")}
        >
          <ChevronLeft size={13} />
        </Button>
        <div className="page-numbers">
          {values.map((value, index) => (
            <span key={value}>
              {index > 0 && value - values[index - 1] > 1 && <i aria-hidden="true">…</i>}
              <button
                aria-label={t("Page {page}", { page: value + 1 })}
                aria-current={safePage === value ? "page" : undefined}
                className={safePage === value ? "active" : ""}
                onClick={() => onPageChange(value)}
              >
                {value + 1}
              </button>
            </span>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          disabled={safePage + 1 >= pages}
          onClick={() => onPageChange(safePage + 1)}
          aria-label={t("Next page")}
          title={t("Next page")}
        >
          <ChevronRight size={13} />
        </Button>
        <Button
          className="page-jump"
          variant="ghost"
          size="icon"
          disabled={safePage + 1 >= pages}
          onClick={() => onPageChange(pages - 1)}
          aria-label={t("Last page")}
          title={t("Last page")}
        >
          <ChevronsRight size={13} />
        </Button>
      </nav>
    </div>
  );
}
