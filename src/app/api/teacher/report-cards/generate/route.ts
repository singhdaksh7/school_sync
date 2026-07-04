import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildReportCardBatchContext, generateReportCardForStudent, getTeacherForSession, serializeReportCard } from "@/lib/report-cards";
import { sessionRole } from "@/lib/tenant";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { createJob, REPORT_CARD_SYNC_LIMIT, isJobWorkerConfigured } from "@/lib/jobs";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRole(session.user) !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await getTeacherForSession(session.user.id);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "REPORT_CARDS");
  if (featureDenied) return featureDenied;
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

  // Large batches must not run in the request (serverless runtime limits). Above
  // the sync threshold we enqueue a durable job and return 202. We refuse to
  // accept a job that could never run (no worker configured) rather than
  // creating invisible stuck work.
  if (requestedStudentIds.length > REPORT_CARD_SYNC_LIMIT) {
    if (!isJobWorkerConfigured()) {
      return NextResponse.json(
        { error: "Batch report-card generation is temporarily unavailable. Please try a smaller selection." },
        { status: 503 }
      );
    }
    const created = await createJob({
      type: "REPORT_CARD_BATCH_GENERATION",
      schoolId: teacher.schoolId,
      createdById: session.user.id,
      payload: {
        schoolId: teacher.schoolId,
        teacherId: teacher.id,
        sectionId: teacher.mentorSectionId,
        examSchemeId,
        studentIds: requestedStudentIds,
        classTeacherRemark: classTeacherRemark ?? null,
      },
      totalItems: requestedStudentIds.length,
    });
    if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });
    return NextResponse.json(
      { mode: "job", jobId: created.job.id, status: created.job.status, totalItems: requestedStudentIds.length },
      { status: 202 }
    );
  }

  // Shared batch context (scheme/template/attendance/exam-results/published
  // cards) is loaded ONCE for the whole selection, not once per student.
  const ctx = await buildReportCardBatchContext({
    schoolId: teacher.schoolId,
    sectionId: teacher.mentorSectionId,
    examSchemeId,
    studentIds: requestedStudentIds,
  });
  if (!ctx) return NextResponse.json({ error: "Exam scheme not found in this school" }, { status: 400 });

  const cards = [];
  for (const studentId of requestedStudentIds) {
    const card = await generateReportCardForStudent(ctx, { teacherId: teacher.id, studentId, classTeacherRemark });
    if (card) cards.push(serializeReportCard(card));
  }

  return NextResponse.json({ success: true, count: cards.length, reportCards: cards });
}
