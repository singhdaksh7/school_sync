import { NextResponse } from "next/server";
import { guardOperationsCapability } from "@/lib/operations-route-guard";
import { computeDailyOperationsSummary } from "@/lib/operations-daily-summary";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const guarded = await guardOperationsCapability(req, schoolId, "EXPENSIVE_READ", "DAILY_OPERATIONS_SUMMARY_VIEW", false);
  if (!guarded.ok) return guarded.deny;

  const { searchParams } = new URL(req.url);
  // Delegated (effective Operations Head) requests never resolve exam/report-
  // card progress — that data is stripped below regardless, and is financial/
  // administrative, not "daily teacher operations" (PART 13).
  const examSchemeId = guarded.ctx.teacherId ? undefined : (searchParams.get("examSchemeId") ?? undefined);

  const summary = await computeDailyOperationsSummary(schoolId, new Date(), { examSchemeId });

  if (guarded.ctx.teacherId) {
    // Effective Operations Head: fee/exam/report-card administrative data is
    // denied by default (PART 13) — redact rather than build a second,
    // parallel "operational" summary composer.
    const { fees: _fees, exams: _exams, reportCards: _reportCards, ...operationalSummary } = summary;
    void _fees;
    void _exams;
    void _reportCards;
    return NextResponse.json(operationalSummary);
  }

  return NextResponse.json(summary);
}
