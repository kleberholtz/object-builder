import * as ProgressPrimitive from "@radix-ui/react-progress";

export function Progress({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, value));
  return <ProgressPrimitive.Root className="progress-root" value={safe}><ProgressPrimitive.Indicator className="progress-indicator" style={{ transform: `translateX(-${100 - safe}%)` }} /></ProgressPrimitive.Root>;
}
