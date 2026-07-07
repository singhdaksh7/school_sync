import { NextResponse } from "next/server";
import { guardOperationsCapability } from "@/lib/operations-route-guard";
import { loadTodayOperationsContext } from "@/lib/operations-context";
import { computeStudentAttendanceSummary, computeAttendanceCompletion, lowestAttendanceSections, pendingOrPartialSections } from "@/lib/operations-attendance";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const guarded = await guardOperationsCapability(req, schoolId, "STANDARD_READ", "OPERATIONS_TODAY_VIEW", false);
  if (!guarded.ok) return guarded.deny;

  const ctx = await loadTodayOperationsContext(schoolId);
  const [summary, completion] = await Promise.all([
    computeStudentAttendanceSummary(schoolId, ctx.dateOnly),
    computeAttendanceCompletion(schoolId, ctx.dateOnly),
  ]);

  return NextResponse.json({
    summary,
    completion,
    lowestSections: lowestAttendanceSections(completion.sections),
    pendingOrPartialSections: pendingOrPartialSections(completion.sections),
  });
}
