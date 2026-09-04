import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function AppMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="h-full px-2.5 text-[12px] text-muted-fg outline-none hover:bg-hover hover:text-foreground data-[state=open]:bg-hover">
        {label}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={2}
          collisionPadding={8}
          className="z-50 min-w-52 max-w-[min(24rem,calc(100vw-1rem))] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-auto rounded-sm border border-border bg-overlay p-1 text-[12px] text-foreground shadow-2xl"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuItem({
  children,
  shortcut,
  onSelect,
  checked,
  disabled,
  keepOpen,
}: {
  children: ReactNode;
  shortcut?: string;
  onSelect?: () => void;
  checked?: boolean;
  disabled?: boolean;
  keepOpen?: boolean;
}) {
  return (
    <DropdownMenu.Item
      onSelect={(event) => {
        if (keepOpen) event.preventDefault();
        onSelect?.();
      }}
      disabled={disabled}
      className="flex min-h-7 cursor-default items-center rounded-sm px-2 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white data-[disabled]:opacity-40"
    >
      <span className="mr-2 flex w-3">{checked && <Check size={12} />}</span>
      <span className="flex-1">{children}</span>
      {shortcut && <span className="ml-5 text-[10px] opacity-60">{shortcut}</span>}
    </DropdownMenu.Item>
  );
}

export function MenuSub({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className="flex h-7 cursor-default items-center rounded-sm px-2 outline-none data-[state=open]:bg-accent data-[highlighted]:bg-accent data-[highlighted]:text-white">
        <span className="mr-2 w-3" />
        <span className="flex-1">{label}</span>
        <ChevronRight size={12} />
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          sideOffset={3}
          collisionPadding={8}
          className="z-50 min-w-60 max-w-[min(28rem,calc(100vw-1rem))] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-auto rounded-sm border border-border bg-overlay p-1 text-[12px] text-foreground shadow-2xl"
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

export const MenuSeparator = DropdownMenu.Separator;

export function IconMenu({
  trigger,
  align = "end",
  className = "",
  children,
}: {
  trigger: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild className={className}>
        {trigger}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={4}
          collisionPadding={8}
          className="z-50 min-w-56 max-w-[min(24rem,calc(100vw-1rem))] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-auto rounded-sm border border-border bg-overlay p-1 text-[12px] text-foreground shadow-2xl"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Label className="px-2 pb-1 pt-1.5 text-[9px] uppercase tracking-wider text-muted-fg">
      {children}
    </DropdownMenu.Label>
  );
}
