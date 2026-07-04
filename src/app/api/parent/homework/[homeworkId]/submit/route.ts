import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";

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
    const attachmentUrl = typeof body.attachmentUrl === "string" ? body.attachmentUrl.trim() : "";
    const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : null;
    const fileType = typeof body.fileType === "string" && body.fileType.trim() ? body.fileType.trim() : null;

    if (!studentId) return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    if (!attachmentUrl) return NextResponse.json({ error: "attachmentUrl is required" }, { status: 400 });

    if (!(await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, studentId))) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

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
          attachmentUrl,
          fileName,
          fileType,
          submittedAt,
          status,
          submissionStatus,
          submissionMethod: "ONLINE",
        },
        update: {
          guardianId: auth.guardian.id,
          attachmentUrl,
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

    return NextResponse.json({ submission }, { status: 201 });
  } catch (error) {
    console.error("Error submitting homework:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
