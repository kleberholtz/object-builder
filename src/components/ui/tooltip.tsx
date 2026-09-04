import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { useT } from "../../lib/i18n";

export function Tooltip({
  children,
  label,
  description,
  shortcut,
}: {
  children: ReactNode;
  label: string;
  description?: string;
  shortcut?: string;
}) {
  const t = useT();
  return (
    <TooltipPrimitive.Root delayDuration={450}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={6}
          collisionPadding={8}
          className="tool-tooltip z-50 rounded border border-border bg-overlay px-2 py-1 text-foreground shadow-xl"
        >
          <strong>{label}</strong>
          {description && <span>{description}</span>}
          {shortcut && <small>{t("Shortcut: {keys}", { keys: shortcut })}</small>}
          <TooltipPrimitive.Arrow className="fill-border" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
