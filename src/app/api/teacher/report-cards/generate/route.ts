import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateReportCardForStudent, getTeacherForSession, serializeReportCard } from "@/lib/report-cards";
import { sessionRole } from "@/lib/tenant";
import { requireTeacherPermission } from "@/lib/teacher-authorization";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRole(session.user) !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await getTeacherForSession(session.user.id);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });
  if (!teacher.mentorSectionId || !teacher.mentorSection) {
    return NextResponse.json({ error: "Only class mentors can generate report cards" }, { status: 403 });
  }

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "REPORT_CARDS", "GENERATE", {
    sectionId: teacher.mentorSectionId,
  });
  if (denied) return denied;

  const { examSchemeId, classTeacherRemark, studentIds } = await req.json();
  if (!examSchemeId) return NextResponse.json({ error: "examSchemeId is required" }, { status: 400 });

  const allowedStudentIds = new Set(teacher.mentorSection.students.map((student) => student.id));
  const requestedStudentIds = Array.isArray(studentIds) && studentIds.length > 0
    ? studentIds.filter((id): id is string => typeof id === "string")
    : [...allowedStudentIds];

  if (requestedStudentIds.some((studentId) => !allowedStudentIds.has(studentId))) {
    return NextResponse.json({ error: "One or more students are not in your mentor section" }, { status: 403 });
  }

  const cards = [];
  for (const studentId of requestedStudentIds) {
    const card = await generateReportCardForStudent({
      schoolId: teacher.schoolId,
      teacherId: teacher.id,
      sectionId: teacher.mentorSectionId,
      examSchemeId,
      studentId,
      classTeacherRemark,
    });
    if (card) cards.push(serializeReportCard(card));
  }

  return NextResponse.json({ success: true, count: cards.length, reportCards: cards });
}
