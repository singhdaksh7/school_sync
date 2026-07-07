import { NextResponse } from "next/server";
import { guardOperationsCapability } from "@/lib/operations-route-guard";
import { loadTodayOperationsContext } from "@/lib/operations-context";
import { classifyTodayLectures, computeNextPeriodRisk } from "@/lib/operations-lecture-coverage";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const guarded = await guardOperationsCapability(req, schoolId, "STANDARD_READ", "NEXT_PERIOD_RISK_VIEW", false);
  if (!guarded.ok) return guarded.deny;

  const ctx = await loadTodayOperationsContext(schoolId);
  const lectures = classifyTodayLectures(ctx);
  const risk = await computeNextPeriodRisk(ctx, lectures);

  return NextResponse.json(risk);
}
