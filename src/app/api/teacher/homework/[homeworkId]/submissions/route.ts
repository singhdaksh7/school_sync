import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole } from "@/lib/tenant";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { getHomeworkForTeacherAccess, getTeacherByUserId, withResolvedAttachments } from "@/lib/homework";
import { resolveManagedOrLegacyUrl } from "@/lib/file-service";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ homeworkId: string }> }
) {
  const { homeworkId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRole(session.user) !== "TEACHER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const teacher = await getTeacherByUserId(session.user.id);
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
