/**
 * Frontend DTO boundary for OperationsCommandCenter.tsx's `activity` field.
 * GET .../operations/daily-summary embeds the ActivityTimelinePage envelope
 * (src/lib/operations-activity.ts: `{ data: ActivityItem[]; total: number }`)
 * as-is under `summary.activity` — it is NOT a bare array. Normalizing once
 * here, at the fetch boundary, means the rest of the component can always
 * treat activity as `OperationsActivityItem[]`.
 */

export interface OperationsActivityItem {
  id: string;
  code: string;
  entityType: string;
  entityId: string | null;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

export function extractActivityItems(activity: unknown): OperationsActivityItem[] {
  if (Array.isArray(activity)) return activity as OperationsActivityItem[];
  if (activity && typeof activity === "object" && Array.isArray((activity as { data?: unknown }).data)) {
    return (activity as { data: OperationsActivityItem[] }).data;
  }
  return [];
}

export function formatActivityCode(code: string): string {
  return code
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
