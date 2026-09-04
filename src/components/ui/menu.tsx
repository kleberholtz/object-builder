import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import type { ReactNode } from "react";

export function AppMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="h-full px-2.5 text-[12px] text-muted-fg outline-none hover:bg-hover hover:text-foreground data-[state=open]:bg-hover">{label}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={2} collisionPadding={8} className="z-50 min-w-52 max-w-[min(24rem,calc(100vw-1rem))] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-auto rounded-sm border border-border bg-overlay p-1 text-[12px] text-foreground shadow-2xl">
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({ children, shortcut, onSelect, checked }: { children: ReactNode; shortcut?: string; onSelect?: () => void; checked?: boolean }) {
  return (
    <DropdownMenu.Item onSelect={onSelect} className="flex h-7 cursor-default items-center rounded-sm px-2 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white">
      <span className="mr-2 flex w-3">{checked && <Check size={12} />}</span><span className="flex-1">{children}</span>{shortcut && <span className="ml-5 text-[10px] opacity-60">{shortcut}</span>}
    </DropdownMenu.Item>
  );
}

export const MenuSeparator = DropdownMenu.Separator;
