import { cn } from "@/lib/utils";

function completionTone(percentage: number) {
  if (percentage >= 90) return "bg-green-500";
  if (percentage >= 70) return "bg-yellow-500";
  return "bg-red-500";
}

interface ProgressProps {
  value: number;
  className?: string;
  trackClassName?: string;
  /** Colors the bar by completion threshold (green/yellow/red) instead of using barClassName. */
  toned?: boolean;
  barClassName?: string;
}

function Progress({ value, className, trackClassName, toned, barClassName }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", trackClassName, className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all",
          toned ? completionTone(clamped) : "bg-primary",
          barClassName
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export { Progress, completionTone };
