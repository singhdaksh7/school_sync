import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { getTeacherByUserId } from "@/lib/homework";

// Read-only Exam listing for the Teacher Marks entry flow — a DIFFERENT
// model from ExamMilestone (which only exists for Notebook Checking).
// Exam has no per-teacher/per-section ownership of its own; the actual
// section-scope authorization already happens in /api/teacher/results
// itself (requireTeacherPermission + the teacher-assigned-to-section check).
// This route only needs to prove the teacher can see marks at all
// (MARKS:VIEW, unscoped) and never selects/infers a "current" exam — every
// exam in the school is returned, ordered by scheme then the exam's own
// `order` field, and the mobile client requires an explicit tap to select
// one.
export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "MARKS", "VIEW");
  if (denied) return denied;

  const exams = await prisma.exam.findMany({
    where: { scheme: { schoolId: teacher.schoolId } },
    select: { id: true, name: true, maxMarks: true, schemeId: true, scheme: { select: { name: true } } },
    orderBy: [{ scheme: { name: "asc" } }, { order: "asc" }],
  });

  return NextResponse.json({
    exams: exams.map((exam) => ({
      id: exam.id,
      name: exam.name,
      maxMarks: exam.maxMarks,
      examSchemeId: exam.schemeId,
      examSchemeName: exam.scheme.name,
    })),
  });
}
