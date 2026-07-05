import { NextResponse } from "next/server";
import { guardOperationsRead } from "@/lib/operations-route-guard";
import { resolveSchoolTodayDateOnly } from "@/lib/operations-context";
import { computeFeeTodaySummary, recentFeePayments } from "@/lib/operations-fees";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const guarded = await guardOperationsRead(schoolId, "STANDARD_READ");
  if (!guarded.ok) return guarded.deny;

  const dateOnly = await resolveSchoolTodayDateOnly(schoolId);
  const [summary, recentPayments] = await Promise.all([
    computeFeeTodaySummary(schoolId, dateOnly),
    recentFeePayments(schoolId),
  ]);

  return NextResponse.json({ summary, recentPayments });
}
