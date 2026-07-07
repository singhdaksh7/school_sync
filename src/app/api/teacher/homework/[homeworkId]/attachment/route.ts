import { NextResponse } from "next/server";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireTeacherPermission } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { getHomeworkForTeacherAccess, getTeacherByUserId } from "@/lib/homework";
import { readUploadedFile, resolveDownloadUrl, uploadManagedFile } from "@/lib/file-service";
import { enforceUploadQuota } from "@/lib/api-cost-guard";
import { homeworkAttachmentRetention } from "@/lib/file-retention";
import { prisma } from "@/lib/prisma";

// Managed upload for a Teacher's OWN homework reference material. Mirrors
// the canonical Admin route (src/app/api/schools/[schoolId]/homework/[homeworkId]/attachment/route.ts)
// exactly — same file-service calls, same HOMEWORK_ATTACHMENT category/quota,
// same managed-file semantics — only the auth/authorization layer differs
// (canonical Teacher context + the Teacher's own assignment scope, via
// getHomeworkForTeacherAccess, instead of canWriteSchool). Accepts EITHER a
// NextAuth web Teacher session or a bearer mobile Teacher JWT via
// getTeacherAuth, same as every other bearer-compatible Teacher route.
export async function POST(
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

  // Scoped to THIS teacher's own/authorized homework — never another
  // teacher's, and never cross-school (getHomeworkForTeacherAccess enforces
  // both school and assignment scope).
  const homework = await getHomeworkForTeacherAccess(homeworkId, teacher.id, teacher.schoolId);
  if (!homework) return NextResponse.json({ error: "Homework not found" }, { status: 404 });
  if (homework.status === "CANCELLED") {
    return NextResponse.json({ error: "Cancelled homework cannot be updated" }, { status: 400 });
  }

  const denied = await requireTeacherPermission(teacher.id, teacher.schoolId, "HOMEWORK", "EDIT", {
    sectionId: homework.sectionId,
  });
  if (denied) return denied;

  const uploadDenied = await enforceUploadQuota({ schoolId: teacher.schoolId, actorType: "TEACHER", actorId: teacher.id }, "HOMEWORK_ATTACHMENT");
  if (uploadDenied) return uploadDenied;

  const upload = await readUploadedFile(req);
  if (!upload) return NextResponse.json({ error: "An attachment file is required" }, { status: 400 });

  const result = await uploadManagedFile({
    category: "HOMEWORK_ATTACHMENT",
    schoolId: teacher.schoolId,
    originalFilename: upload.filename,
    declaredContentType: upload.declaredContentType,
    bytes: upload.bytes,
    uploader: { type: "USER", id: teacherAuth.userId },
    retention: homeworkAttachmentRetention(homework.dueDate),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await prisma.homework.update({ where: { id: homework.id }, data: { attachmentFileId: result.file.id } });

  const url = await resolveDownloadUrl(result.file);
  return NextResponse.json({ file: { id: result.file.id, url, contentType: result.file.contentType } }, { status: 201 });
}
