export type DistributionSegment = { label: string; value: number; color: string };

interface StatusDistributionBarProps {
  segments: DistributionSegment[];
  emptyMessage?: string;
}

export default function StatusDistributionBar({
  segments,
  emptyMessage = "No data yet",
}: StatusDistributionBarProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border py-10 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
        {segments.map((s) =>
          s.value > 0 ? (
            <div key={s.label} className={s.color} style={{ width: `${(s.value / total) * 100}%` }} />
          ) : null
        )}
      </div>
      <ul className="space-y-2.5">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className={`h-2 w-2 rounded-full ${s.color}`} />
              {s.label}
            </span>
            <span className="font-semibold text-foreground">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
