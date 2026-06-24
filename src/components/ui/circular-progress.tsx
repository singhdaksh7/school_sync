import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { completionTone } from "@/components/ui/progress";

interface CircularProgressProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  toned?: boolean;
  className?: string;
  label?: ReactNode;
}

const TONE_STROKE: Record<string, string> = {
  "bg-green-500": "stroke-green-500",
  "bg-yellow-500": "stroke-yellow-500",
  "bg-red-500": "stroke-red-500",
};

function CircularProgress({ value, size = 80, strokeWidth = 8, toned = true, className, label }: CircularProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const strokeClass = toned ? TONE_STROKE[completionTone(clamped)] : "stroke-primary";

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={strokeWidth} className="fill-none stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn("fill-none transition-all", strokeClass)}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {label ?? <span className="text-sm font-bold text-foreground">{Math.round(clamped)}%</span>}
      </div>
    </div>
  );
}

export { CircularProgress };
