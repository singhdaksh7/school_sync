import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { getActiveExamMilestones, getTeacherByUserId } from "@/lib/homework";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRole(session.user) !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await getTeacherByUserId(session.user.id);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "NOTEBOOK_CHECKING");
  if (featureDenied) return featureDenied;

  const milestones = await getActiveExamMilestones(teacher.schoolId);
  return NextResponse.json({ milestones });
}
