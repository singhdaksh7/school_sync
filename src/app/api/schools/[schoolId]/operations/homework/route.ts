import { NextResponse } from "next/server";
import { guardOperationsRead } from "@/lib/operations-route-guard";
import { resolveSchoolTodayDateOnly } from "@/lib/operations-context";
import { computeHomeworkTodaySummary, topPendingReviewGroups } from "@/lib/operations-homework";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const guarded = await guardOperationsRead(schoolId, "STANDARD_READ");
  if (!guarded.ok) return guarded.deny;

  const now = new Date();
  const dateOnly = await resolveSchoolTodayDateOnly(schoolId, now);
  const [summary, topPendingReview] = await Promise.all([
    computeHomeworkTodaySummary(schoolId, dateOnly, now),
    topPendingReviewGroups(schoolId),
  ]);

  return NextResponse.json({ summary, topPendingReview });
}
