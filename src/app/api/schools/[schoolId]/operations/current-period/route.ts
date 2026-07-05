import { NextResponse } from "next/server";
import { guardOperationsCapability } from "@/lib/operations-route-guard";
import { loadTodayOperationsContext } from "@/lib/operations-context";
import { classifyTodayLectures, computeCurrentPeriodOperations } from "@/lib/operations-lecture-coverage";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const guarded = await guardOperationsCapability(schoolId, "STANDARD_READ", "CURRENT_PERIOD_VIEW", false);
  if (!guarded.ok) return guarded.deny;

  const ctx = await loadTodayOperationsContext(schoolId);
  const lectures = classifyTodayLectures(ctx);
  const current = await computeCurrentPeriodOperations(ctx, lectures);

  return NextResponse.json(current);
}
