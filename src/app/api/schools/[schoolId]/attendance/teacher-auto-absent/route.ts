import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { runTeacherAutoAbsent } from "@/lib/teacher-attendance";

export async function POST(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "ATTENDANCE");
    if (denied) return denied;
  }

  const result = await runTeacherAutoAbsent(schoolId, session.user.id);
  if ("error" in result) {
    const status = result.error === "School not found" ? 404 : 400;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json({ success: true, ...result });
}
