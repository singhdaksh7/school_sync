import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { readUploadedFile, resolveDownloadUrl, uploadManagedFile } from "@/lib/file-service";

// Managed upload for the school's branding logo. Replaces trusting a
// client-supplied `logoUrl` for the primary flow — the object is validated,
// stored via the configured StorageProvider, and linked via School.logoFileId.
// The legacy `logoUrl` string field is left untouched for historical rows.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ schoolId: string }> }
) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "WHITE_LABEL");
    if (denied) return denied;
  }

  const upload = await readUploadedFile(req);
  if (!upload) return NextResponse.json({ error: "A logo file is required" }, { status: 400 });

  const result = await uploadManagedFile({
    category: "BRANDING_IMAGE",
    schoolId,
    originalFilename: upload.filename,
    declaredContentType: upload.declaredContentType,
    bytes: upload.bytes,
    uploader: { type: "USER", id: session.user.id },
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  const previousFileId = (
    await prisma.school.findUnique({ where: { id: schoolId }, select: { logoFileId: true } })
  )?.logoFileId;

  await prisma.school.update({ where: { id: schoolId }, data: { logoFileId: result.file.id } });

  // Old asset row is intentionally left in place (not deleted) — a historical
  // reference elsewhere may still point at it. Storage cleanup is out of scope.
  void previousFileId;

  const url = await resolveDownloadUrl(result.file);
  return NextResponse.json({ file: { id: result.file.id, url, contentType: result.file.contentType } }, { status: 201 });
}
