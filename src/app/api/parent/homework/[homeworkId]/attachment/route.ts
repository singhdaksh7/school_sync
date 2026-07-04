import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { readUploadedFile, resolveDownloadUrl, uploadManagedFile } from "@/lib/file-service";

// Guardian upload for a homework submission attachment. Enforces the
// guardian-child relationship and that the homework belongs to the guardian's
// own school BEFORE any bytes are validated/stored. The returned file id is
// SCOPED_PRIVATE and is later attached via POST .../submit { attachmentFileId }.
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

    const homework = await prisma.homework.findFirst({
      where: { id: homeworkId, schoolId: auth.guardian.schoolId },
      select: { id: true, sectionId: true, status: true },
    });
    if (!homework) return NextResponse.json({ error: "Homework not found" }, { status: 404 });
    if (homework.status !== "ACTIVE") {
      return NextResponse.json({ error: "Homework is not active" }, { status: 400 });
    }

    const studentId = req.nextUrl.searchParams.get("studentId") ?? "";
    if (!studentId) return NextResponse.json({ error: "studentId is required" }, { status: 400 });
    if (!(await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, studentId))) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }
    const student = await prisma.student.findFirst({
      where: { id: studentId, schoolId: auth.guardian.schoolId, sectionId: homework.sectionId },
      select: { id: true },
    });
    if (!student) {
      return NextResponse.json({ error: "Student is not in this homework section" }, { status: 400 });
    }

    const upload = await readUploadedFile(req);
    if (!upload) return NextResponse.json({ error: "An attachment file is required" }, { status: 400 });

    const result = await uploadManagedFile({
      category: "HOMEWORK_SUBMISSION",
      schoolId: auth.guardian.schoolId,
      originalFilename: upload.filename,
      declaredContentType: upload.declaredContentType,
      bytes: upload.bytes,
      uploader: { type: "GUARDIAN", id: auth.guardian.id },
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const url = await resolveDownloadUrl(result.file);
    return NextResponse.json({ file: { id: result.file.id, url, contentType: result.file.contentType } }, { status: 201 });
  } catch (error) {
    console.error("Error uploading homework submission attachment:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
