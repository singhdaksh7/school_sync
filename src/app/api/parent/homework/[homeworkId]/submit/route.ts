import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { resolveManagedOrLegacyUrl } from "@/lib/file-service";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ homeworkId: string }> }
) {
  try {
    const { homeworkId } = await params;
    const auth = await getAuthenticatedGuardian(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const featureDenied = await requireSchoolFeature(auth.guardian.schoolId, "HOMEWORK");
    if (featureDenied) return featureDenied;

    const body = await req.json();
    const studentId = typeof body.studentId === "string" ? body.studentId : "";
    const attachmentFileId = typeof body.attachmentFileId === "string" ? body.attachmentFileId.trim() : "";
    // Legacy fallback for an older client that hasn't migrated to the managed
    // upload flow yet (POST .../homework/[id]/attachment → attachmentFileId).
    // Deprecated: only same-origin/https URLs are accepted, and it is never
    // used for anything more sensitive than an inline "view attachment" link.
    const legacyAttachmentUrl = typeof body.attachmentUrl === "string" ? body.attachmentUrl.trim() : "";

    if (!studentId) return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    if (!attachmentFileId && !legacyAttachmentUrl) {
      return NextResponse.json({ error: "attachmentFileId is required (upload the file first)" }, { status: 400 });
    }
    if (legacyAttachmentUrl && !/^https:\/\//i.test(legacyAttachmentUrl)) {
      return NextResponse.json({ error: "attachmentUrl must be an https URL" }, { status: 400 });
    }

    if (!(await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, studentId))) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    let storedFile: { id: string; originalFilename: string; contentType: string } | null = null;
    if (attachmentFileId) {
      // The file must have been uploaded by THIS guardian, for THIS school, as
      // a homework-submission asset — object-key possession alone is never
      // treated as authorization (see src/lib/storage.ts).
      storedFile = await prisma.storedFile.findFirst({
        where: {
          id: attachmentFileId,
          schoolId: auth.guardian.schoolId,
          category: "HOMEWORK_SUBMISSION",
          uploaderType: "GUARDIAN",
          uploaderId: auth.guardian.id,
        },
        select: { id: true, originalFilename: true, contentType: true },
      });
      if (!storedFile) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }
    // Do NOT persist a resolved URL for the managed path — SCOPED_PRIVATE URLs
    // are short-lived signed links; the FK is the durable reference and is
    // re-resolved on read. The legacy URL path stores the URL as-is (it was
    // already a plain external link, not a signed one).
    const fileName = storedFile?.originalFilename ?? (typeof body.fileName === "string" ? body.fileName.trim() || null : null);
    const fileType = storedFile?.contentType ?? (typeof body.fileType === "string" ? body.fileType.trim() || null : null);

    const homework = await prisma.homework.findFirst({
      where: {
        id: homeworkId,
        schoolId: auth.guardian.schoolId,
      },
      select: {
        id: true,
        schoolId: true,
        sectionId: true,
        dueDate: true,
        deadlineAt: true,
        status: true,
      },
    });
    if (!homework) return NextResponse.json({ error: "Homework not found" }, { status: 404 });
    if (homework.status !== "ACTIVE") {
      return NextResponse.json({ error: "Homework is not active" }, { status: 400 });
    }

    const student = await prisma.student.findFirst({
      where: {
        id: studentId,
        schoolId: auth.guardian.schoolId,
        sectionId: homework.sectionId,
      },
      select: { id: true },
    });
    if (!student) {
      return NextResponse.json({ error: "Student is not in this homework section" }, { status: 400 });
    }

    const existingStatus = await prisma.homeworkStudentStatus.findUnique({
      where: { homeworkId_studentId: { homeworkId: homework.id, studentId } },
      select: { submissionStatus: true },
    });
    if (existingStatus?.submissionStatus === "CHECKED") {
      return NextResponse.json({ error: "Checked homework cannot be resubmitted" }, { status: 400 });
    }

    const submittedAt = new Date();
    const status = submittedAt > homework.deadlineAt ? "LATE" : "SUBMITTED";
    const submissionStatus = status === "LATE" ? "LATE_SUBMITTED" : "SUBMITTED";

    const submission = await prisma.$transaction(async (tx) => {
      const saved = await tx.homeworkSubmission.upsert({
        where: { homeworkId_studentId: { homeworkId: homework.id, studentId } },
        create: {
          schoolId: homework.schoolId,
          homeworkId: homework.id,
          studentId,
          guardianId: auth.guardian.id,
          attachmentFileId: storedFile?.id ?? null,
          attachmentUrl: storedFile ? null : legacyAttachmentUrl,
          fileName,
          fileType,
          submittedAt,
          status,
          submissionStatus,
          submissionMethod: "ONLINE",
        },
        update: {
          guardianId: auth.guardian.id,
          attachmentFileId: storedFile?.id ?? null,
          attachmentUrl: storedFile ? null : legacyAttachmentUrl,
          fileName,
          fileType,
          submittedAt,
          status,
          submissionStatus,
          submissionMethod: "ONLINE",
          teacherRemark: null,
          score: null,
          maxScore: null,
          reviewedAt: null,
          checkedAt: null,
        },
      });

      await tx.homeworkStudentStatus.upsert({
        where: { homeworkId_studentId: { homeworkId: homework.id, studentId } },
        create: {
          homeworkId: homework.id,
          studentId,
          status,
          submissionStatus,
          submissionMethod: "ONLINE",
          submittedAt,
        },
        update: {
          status,
          submissionStatus,
          submissionMethod: "ONLINE",
          submittedAt,
          score: null,
          maxScore: null,
          teacherRemark: null,
          checkedAt: null,
        },
      });

      return saved;
    });

    const attachmentUrl = await resolveManagedOrLegacyUrl(submission);
    return NextResponse.json({ submission: { ...submission, attachmentUrl } }, { status: 201 });
  } catch (error) {
    console.error("Error submitting homework:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
