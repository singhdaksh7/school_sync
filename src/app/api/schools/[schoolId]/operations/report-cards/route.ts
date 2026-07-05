import { NextResponse } from "next/server";
import { guardOperationsRead } from "@/lib/operations-route-guard";
import { computeReportCardProgress } from "@/lib/operations-report-cards";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const guarded = await guardOperationsRead(schoolId, "STANDARD_READ");
  if (!guarded.ok) return guarded.deny;

  const { searchParams } = new URL(req.url);
  const examSchemeId = searchParams.get("examSchemeId");
  if (!examSchemeId) {
    return NextResponse.json({ error: "examSchemeId query parameter is required — the current exam cannot be inferred" }, { status: 400 });
  }

  const progress = await computeReportCardProgress(schoolId, examSchemeId);
  if (!progress) return NextResponse.json({ error: "Exam scheme not found in this school" }, { status: 404 });

  return NextResponse.json(progress);
}
