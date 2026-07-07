import { NextResponse } from "next/server";
import { guardOperationsCapability } from "@/lib/operations-route-guard";
import { loadTodayOperationsContext } from "@/lib/operations-context";
import { computeTeacherWorkloadToday, summarizeTeacherWorkload } from "@/lib/operations-teacher-workload";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const guarded = await guardOperationsCapability(req, schoolId, "STANDARD_READ", "TEACHER_WORKLOAD_VIEW", false);
  if (!guarded.ok) return guarded.deny;

  const ctx = await loadTodayOperationsContext(schoolId);
  const rows = computeTeacherWorkloadToday(ctx);
  const summary = summarizeTeacherWorkload(rows);

  return NextResponse.json({ summary, rows });
}
