import { cn } from "@/lib/utils";

export type TrendPoint = { label: string; value: number };

interface TrendBarChartProps {
  data: TrendPoint[];
  variant?: "bar" | "line";
  color?: string;
  formatValue?: (value: number) => string;
  height?: number;
  emptyMessage?: string;
}

const defaultFormat = (value: number) => String(value);

export default function TrendBarChart({
  data,
  variant = "bar",
  color = "#6366f1",
  formatValue = defaultFormat,
  height = 140,
  emptyMessage = "Not enough data yet",
}: TrendBarChartProps) {
  const hasData = data.length > 0 && data.some((d) => d.value > 0);

  if (!hasData) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-center"
        style={{ height }}
      >
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value), 1);

  if (variant === "line") {
    const w = 100;
    const padY = 8;
    const usableH = height - padY * 2;
    const stepX = data.length > 1 ? w / (data.length - 1) : 0;
    const points = data.map((d, i) => {
      const x = data.length > 1 ? i * stepX : w / 2;
      const y = padY + (usableH - (d.value / max) * usableH);
      return { x, y, d };
    });
    const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
    const areaPath = `M${points[0].x},${height - 2} ${points
      .map((p) => `L${p.x},${p.y}`)
      .join(" ")} L${points[points.length - 1].x},${height - 2} Z`;

    return (
      <div>
        <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
          <path d={areaPath} fill={color} opacity={0.08} />
          <polyline points={polyline} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={1.6} fill={color} />
          ))}
        </svg>
        <div className="mt-1 flex justify-between gap-1">
          {data.map((d, i) => (
            <span key={i} className="flex-1 truncate text-center text-[10px] text-muted-foreground">
              {d.label}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-end gap-2" style={{ height }}>
        {data.map((d, i) => {
          const barH = Math.max(2, Math.round((d.value / max) * (height - 24)));
          return (
            <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
              <span className="text-[10px] font-medium text-muted-foreground">{formatValue(d.value)}</span>
              <div
                className={cn("w-full rounded-t-sm transition-all")}
                style={{ height: barH, backgroundColor: color }}
                title={`${d.label}: ${formatValue(d.value)}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2">
        {data.map((d, i) => (
          <span key={i} className="flex-1 truncate text-center text-[10px] text-muted-foreground">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
