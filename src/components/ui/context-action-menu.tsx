import { createPortal } from "react-dom";
import { useEffect, type ReactNode } from "react";

export interface ContextAction {
  label: string;
  icon?: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export interface ContextMenuState<T> {
  x: number;
  y: number;
  target: T;
}

export function ContextActionMenu({
  menu,
  actions,
  onClose,
}: {
  menu: ContextMenuState<unknown> | null;
  actions: ContextAction[];
  onClose: () => void;
}) {
  useEffect(() => {
    if (!menu) return;
    const pointer = (event: PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest(".context-action-menu")) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const scroll = () => onClose();
    window.addEventListener("pointerdown", pointer);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    window.addEventListener("scroll", scroll, true);
    return () => {
      window.removeEventListener("pointerdown", pointer);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [menu, onClose]);
  if (!menu) return null;
  return createPortal(
    <div
      className="context-action-menu"
      style={{
        left: Math.max(8, Math.min(menu.x, window.innerWidth - 210)),
        top: Math.max(8, Math.min(menu.y, window.innerHeight - actions.length * 32 - 12)),
      }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          className={action.danger ? "danger" : ""}
          disabled={action.disabled}
          onClick={() => {
            action.onSelect();
            onClose();
          }}
        >
          <span>
            {action.icon}
            {action.label}
          </span>
          {action.shortcut && <kbd>{action.shortcut}</kbd>}
        </button>
      ))}
    </div>,
    document.body,
  );
}
