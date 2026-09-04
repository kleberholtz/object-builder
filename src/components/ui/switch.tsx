import * as SwitchPrimitive from "@radix-ui/react-switch";

export function Switch(props: SwitchPrimitive.SwitchProps) {
  return (
    <SwitchPrimitive.Root className="relative h-4 w-7 rounded-full border border-border bg-input data-[state=checked]:border-accent data-[state=checked]:bg-accent" {...props}>
      <SwitchPrimitive.Thumb className="block h-3 w-3 translate-x-px rounded-full bg-dim transition-transform data-[state=checked]:translate-x-[13px] data-[state=checked]:bg-white" />
    </SwitchPrimitive.Root>
  );
}

