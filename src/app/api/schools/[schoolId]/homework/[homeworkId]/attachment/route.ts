import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { readUploadedFile, resolveDownloadUrl, uploadManagedFile } from "@/lib/file-service";

// Managed upload for a homework attachment. The resulting file always belongs
// to the same school as the homework record (enforced by generateStorageKey's
// tenant namespace and by scoping this route to schoolId + homeworkId).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ schoolId: string; homeworkId: string }> }
) {
  const { schoolId, homeworkId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "HOMEWORK");
    if (denied) return denied;
  }

  const homework = await prisma.homework.findFirst({ where: { id: homeworkId, schoolId }, select: { id: true, status: true } });
  if (!homework) return NextResponse.json({ error: "Homework not found" }, { status: 404 });
  if (homework.status === "CANCELLED") {
    return NextResponse.json({ error: "Cancelled homework cannot be updated" }, { status: 400 });
  }

  const upload = await readUploadedFile(req);
  if (!upload) return NextResponse.json({ error: "An attachment file is required" }, { status: 400 });

  const result = await uploadManagedFile({
    category: "HOMEWORK_ATTACHMENT",
    schoolId,
    originalFilename: upload.filename,
    declaredContentType: upload.declaredContentType,
    bytes: upload.bytes,
    uploader: { type: "USER", id: session.user.id },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  await prisma.homework.update({ where: { id: homeworkId }, data: { attachmentFileId: result.file.id } });

  const url = await resolveDownloadUrl(result.file);
  return NextResponse.json({ file: { id: result.file.id, url, contentType: result.file.contentType } }, { status: 201 });
}
