import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { useT } from "../../lib/i18n";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  children,
  title,
  description,
  className = "",
  overlayClassName = "",
}: {
  children: ReactNode;
  title: string;
  description?: string;
  className?: string;
  overlayClassName?: string;
}) {
  const t = useT();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={`dialog-overlay ${overlayClassName}`} />
      <DialogPrimitive.Content
        className={`dialog-content ${className}`}
        aria-describedby={description ? undefined : undefined}
      >
        <header className="dialog-header">
          <div>
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description>{description}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="dialog-close" aria-label={t("Close")}>
            <X size={15} />
          </DialogPrimitive.Close>
        </header>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
