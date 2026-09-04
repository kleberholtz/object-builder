import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

export function Select({ value, onValueChange, options, ariaLabel }: { value: string; onValueChange: (value: string) => void; options: Array<{ value: string; label: string }>; ariaLabel: string }) {
  return <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
    <SelectPrimitive.Trigger className="select-trigger" aria-label={ariaLabel}><SelectPrimitive.Value /><SelectPrimitive.Icon><ChevronDown size={12} /></SelectPrimitive.Icon></SelectPrimitive.Trigger>
    <SelectPrimitive.Portal><SelectPrimitive.Content position="popper" sideOffset={3} collisionPadding={8} className="select-content"><SelectPrimitive.Viewport>
      {options.map((option) => <SelectPrimitive.Item key={option.value} value={option.value} className="select-item"><SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText><SelectPrimitive.ItemIndicator><Check size={12} /></SelectPrimitive.ItemIndicator></SelectPrimitive.Item>)}
    </SelectPrimitive.Viewport></SelectPrimitive.Content></SelectPrimitive.Portal>
  </SelectPrimitive.Root>;
}
