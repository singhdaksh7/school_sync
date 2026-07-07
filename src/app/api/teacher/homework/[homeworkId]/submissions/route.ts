import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { getHomeworkForTeacherAccess, getTeacherByUserId, withResolvedAttachments } from "@/lib/homework";
import { resolveManagedOrLegacyUrl } from "@/lib/file-service";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ homeworkId: string }> }
) {
  const { homeworkId } = await params;
  const teacherAuth = await getTeacherAuth(req);
  if (!teacherAuth?.teacherId || !teacherAuth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const teacher = await getTeacherByUserId(teacherAuth.userId);
  if (!teacher) return NextResponse.json({ error: "Teacher not found" }, { status: 404 });

  const featureDenied = await requireSchoolFeature(teacher.schoolId, "HOMEWORK");
  if (featureDenied) return featureDenied;

  const homework = await getHomeworkForTeacherAccess(homeworkId, teacher.id, teacher.schoolId);
  if (!homework) return NextResponse.json({ error: "Homework not found" }, { status: 404 });

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "HOMEWORK", "VIEW", {
    sectionId: homework.sectionId,
  });
  if (denied) return denied;

  const submissions = await prisma.homeworkSubmission.findMany({
    where: {
      schoolId: teacher.schoolId,
      homeworkId: homework.id,
      student: {
        schoolId: teacher.schoolId,
        sectionId: homework.sectionId,
      },
    },
    include: {
      student: { select: { id: true, name: true, rollNo: true, sectionId: true } },
      guardian: { select: { id: true, name: true, phone: true } },
    },
    orderBy: [{ student: { rollNo: "asc" } }, { submittedAt: "desc" }],
  });

  // Managed file takes precedence over a legacy attachmentUrl on every
  // submission returned here (see resolveManagedOrLegacyUrl).
  const resolvedSubmissions = await Promise.all(
    submissions.map(async (submission) => ({ ...submission, attachmentUrl: await resolveManagedOrLegacyUrl(submission) }))
  );

  return NextResponse.json({ homework: await withResolvedAttachments(homework), submissions: resolvedSubmissions });
}
