import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole, canAccessSchool, canAccessSchoolForBilling } from "@/lib/tenant";
import { requireFounderSession } from "@/lib/founder";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { getStorageProvider, storagePublicUrl, MemoryStorageProvider } from "@/lib/storage";
import { resolveDownloadUrl } from "@/lib/file-service";

/**
 * Controlled file-access route. StoredFile metadata (visibility + category +
 * schoolId) is ALWAYS resolved and authorized FIRST — the storage key/object
 * id is never treated as authorization on its own (an attacker who guesses or
 * leaks a fileId still can't read it without passing this check).
 *
 * PUBLIC objects redirect straight to the public base URL. Everything else
 * either redirects to a short-lived signed URL (production S3-compatible
 * provider) or streams the bytes directly (MemoryStorageProvider — dev/test,
 * where there is no independently-fetchable URL to sign).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  const file = await prisma.storedFile.findUnique({ where: { id: fileId } });
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (file.visibility === "PUBLIC") {
    const url = storagePublicUrl(file.storageKey);
    if (url) return NextResponse.redirect(url);
    return streamObject(file);
  }

  const authorized = await isAuthorizedForFile(req, file);
  if (!authorized) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const provider = getStorageProvider();
  if (provider instanceof MemoryStorageProvider) {
    return streamObject(file);
  }
  const url = await resolveDownloadUrl(file);
  return NextResponse.redirect(url);
}

async function streamObject(file: { storageKey: string; contentType: string; originalFilename: string }) {
  const obj = await getStorageProvider().getObject(file.storageKey);
  if (!obj) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(obj.body), {
    status: 200,
    headers: {
      "content-type": obj.contentType || file.contentType,
      "content-disposition": `inline; filename="${file.originalFilename.replace(/"/g, "")}"`,
      "cache-control": "private, max-age=60",
    },
  });
}

type FileRow = Awaited<ReturnType<typeof prisma.storedFile.findUnique>>;

async function isAuthorizedForFile(req: NextRequest, file: NonNullable<FileRow>): Promise<boolean> {
  if (file.visibility === "BILLING_PRIVATE") {
    const founder = await requireFounderSession();
    if (founder) return true;
    const session = await auth();
    if (session?.user?.id && file.schoolId) {
      return canAccessSchoolForBilling(file.schoolId, session.user.id, sessionRole(session.user));
    }
    return false;
  }

  if (file.visibility === "TENANT_PRIVATE") {
    if (!file.schoolId) return false;
    const session = await auth();
    if (session?.user?.id && (await canAccessSchool(file.schoolId, session.user.id))) return true;
    if (session?.user?.id && sessionRole(session.user) === "TEACHER") {
      const teacher = await prisma.teacher.findFirst({ where: { userId: session.user.id, schoolId: file.schoolId, isDeleted: false } });
      if (teacher) return true;
    }
    const guardian = await getAuthenticatedGuardian(req);
    if (guardian && guardian.guardian.schoolId === file.schoolId) return true;
    const student = await getStudentAuth(req);
    if (student && student.schoolId === file.schoolId) return true;
    return false;
  }

  if (file.visibility === "SCOPED_PRIVATE") {
    if (!file.schoolId) return false;

    // Staff of the owning school can always view scoped-private assets
    // (teacher reviewing a submission, admin viewing a report card, etc).
    const session = await auth();
    if (session?.user?.id && (await canAccessSchool(file.schoolId, session.user.id))) return true;
    if (session?.user?.id && sessionRole(session.user) === "TEACHER") {
      const teacher = await prisma.teacher.findFirst({ where: { userId: session.user.id, schoolId: file.schoolId, isDeleted: false } });
      if (teacher) return true;
    }

    if (file.category === "HOMEWORK_SUBMISSION") {
      const submission = await prisma.homeworkSubmission.findFirst({
        where: { attachmentFileId: file.id, schoolId: file.schoolId },
        select: { studentId: true, guardianId: true },
      });
      if (!submission) return false;
      const guardian = await getAuthenticatedGuardian(req);
      if (guardian && guardian.guardian.id === submission.guardianId) return true;
      const student = await getStudentAuth(req);
      if (student && student.studentId === submission.studentId) return true;
      return false;
    }

    // Other SCOPED_PRIVATE categories (e.g. a student's own report card asset)
    // default to guardian/student ownership via direct StoredFile.uploaderId.
    const guardian = await getAuthenticatedGuardian(req);
    if (guardian && file.uploaderType === "GUARDIAN" && guardian.guardian.id === file.uploaderId) return true;
    const student = await getStudentAuth(req);
    if (student && file.uploaderType === "STUDENT" && student.studentId === file.uploaderId) return true;
    return false;
  }

  return false;
}
