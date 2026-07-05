import { NextResponse } from "next/server";
import { guardOperationsCapability } from "@/lib/operations-route-guard";
import { computeTodayAtSchoolSummary } from "@/lib/operations-today-summary";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const guarded = await guardOperationsCapability(schoolId, "STANDARD_READ", "OPERATIONS_TODAY_VIEW", false);
  if (!guarded.ok) return guarded.deny;

  const summary = await computeTodayAtSchoolSummary(schoolId);
  return NextResponse.json(summary);
}
