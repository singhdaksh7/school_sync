import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { allStudentsBelongToSchool, examMilestoneBelongsToSchool } from "@/lib/tenant";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { logAudit } from "@/lib/audit";
import { getTeacherByUserId, normalizeSubject, teacherCanTeachSubjectSection } from "@/lib/homework";

interface CheckInput {
  studentId: string;
  checked: boolean;
  remarks?: string | null;
}

export async function GET(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "NOTEBOOK_CHECKING");
  if (featureDenied) return featureDenied;

  const { searchParams } = new URL(req.url);
  const sectionId = searchParams.get("sectionId");
  const subject = normalizeSubject(searchParams.get("subject"));
  const examMilestoneId = searchParams.get("examMilestoneId");
  if (!sectionId || !subject || !examMilestoneId) {
    return NextResponse.json({ error: "sectionId, subject and examMilestoneId are required" }, { status: 400 });
  }

  const canTeach = await teacherCanTeachSubjectSection(teacher.id, teacher.schoolId, sectionId, subject);
  if (!canTeach) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "NOTEBOOK", "VIEW", { sectionId });
  if (denied) return denied;

  const milestoneOk = await examMilestoneBelongsToSchool(examMilestoneId, teacher.schoolId);
  if (!milestoneOk) return NextResponse.json({ error: "Exam milestone not found" }, { status: 404 });

  const students = await prisma.student.findMany({
    where: { schoolId: teacher.schoolId, sectionId },
    select: { id: true, name: true, rollNo: true },
    orderBy: { rollNo: "asc" },
  });

  const checks = await prisma.notebookCheck.findMany({
    where: { schoolId: teacher.schoolId, examMilestoneId, subject: { equals: subject, mode: "insensitive" }, studentId: { in: students.map((s) => s.id) } },
  });
  const checksByStudentId = new Map(checks.map((c) => [c.studentId, c]));

  const roster = students.map((student) => {
    const check = checksByStudentId.get(student.id);
    return {
      studentId: student.id,
      name: student.name,
      rollNo: student.rollNo,
      checked: check?.checked ?? false,
      checkedAt: check?.checkedAt ?? null,
      remarks: check?.remarks ?? null,
    };
  });

  return NextResponse.json({ roster });
}

export async function PATCH(req: Request) {
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "NOTEBOOK_CHECKING");
  if (featureDenied) return featureDenied;

  const body = await req.json();
  const sectionId = typeof body.sectionId === "string" ? body.sectionId : "";
  const subject = normalizeSubject(body.subject);
  const examMilestoneId = typeof body.examMilestoneId === "string" ? body.examMilestoneId : "";
  const checks = Array.isArray(body.checks) ? (body.checks as CheckInput[]) : [];

  if (!sectionId || !subject || !examMilestoneId) {
    return NextResponse.json({ error: "sectionId, subject and examMilestoneId are required" }, { status: 400 });
  }
  if (checks.length === 0) return NextResponse.json({ error: "Checks are required" }, { status: 400 });

  const uniqueStudentIds = [...new Set(checks.map((c) => c.studentId).filter(Boolean))];
  if (uniqueStudentIds.length !== checks.length) {
    return NextResponse.json({ error: "Each check must reference a unique student" }, { status: 400 });
  }
  if (checks.some((c) => typeof c.checked !== "boolean")) {
    return NextResponse.json({ error: "checked must be a boolean" }, { status: 400 });
  }

  const canTeach = await teacherCanTeachSubjectSection(teacher.id, teacher.schoolId, sectionId, subject);
  if (!canTeach) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "NOTEBOOK", "MARK", { sectionId });
  if (denied) return denied;

  const milestone = await prisma.examMilestone.findFirst({ where: { id: examMilestoneId, schoolId: teacher.schoolId } });
  if (!milestone) return NextResponse.json({ error: "Exam milestone not found" }, { status: 404 });
  if (!milestone.active) return NextResponse.json({ error: "This exam milestone is disabled" }, { status: 400 });

  const studentsOk = await allStudentsBelongToSchool(uniqueStudentIds, teacher.schoolId, sectionId);
  if (!studentsOk) return NextResponse.json({ error: "One or more students are not in this section" }, { status: 400 });

  const now = new Date();
  let checkedCount = 0;
  let uncheckedCount = 0;

  await prisma.$transaction(
    checks.map((item) => {
      if (item.checked) checkedCount += 1;
      else uncheckedCount += 1;
      const remarks = typeof item.remarks === "string" && item.remarks.trim() ? item.remarks.trim() : null;
      return prisma.notebookCheck.upsert({
        where: { studentId_subject_examMilestoneId: { studentId: item.studentId, subject, examMilestoneId } },
        create: {
          schoolId: teacher.schoolId,
          studentId: item.studentId,
          teacherId: teacher.id,
          subject,
          examMilestoneId,
          checked: item.checked,
          checkedAt: item.checked ? now : null,
          remarks,
        },
        update: {
          teacherId: teacher.id,
          checked: item.checked,
          checkedAt: item.checked ? now : null,
          remarks,
        },
      });
    })
  );

  await logAudit({
    action: "NOTEBOOK_CHECK_UPDATED",
    entityType: "NotebookCheck",
    metadata: { sectionId, subject, examMilestoneId, checkedCount, uncheckedCount },
    userId: teacherAuth.userId,
    schoolId: teacher.schoolId,
    actorRole: "TEACHER",
  });

  return NextResponse.json({ success: true });
}
