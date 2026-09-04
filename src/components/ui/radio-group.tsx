import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "../../lib/utils";

export function RadioGroup({ className, ...props }: RadioGroupPrimitive.RadioGroupProps) {
  return <RadioGroupPrimitive.Root className={cn("flex flex-col gap-1", className)} {...props} />;
}

export function RadioGroupItem({ className, ...props }: RadioGroupPrimitive.RadioGroupItemProps) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-border bg-input outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 data-[state=checked]:border-accent data-[state=checked]:bg-accent",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="block h-1.5 w-1.5 rounded-full bg-white" />
    </RadioGroupPrimitive.Item>
  );
}
