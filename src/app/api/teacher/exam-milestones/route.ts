import { NextResponse } from "next/server";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { getActiveExamMilestones, getTeacherByUserId } from "@/lib/homework";

export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "NOTEBOOK_CHECKING");
  if (featureDenied) return featureDenied;

  const milestones = await getActiveExamMilestones(teacher.schoolId);
  return NextResponse.json({ milestones });
}
