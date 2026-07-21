import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryCatalogueManage } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, unauthorized } from "@/lib/library/http";
import { uploadManagedFile } from "@/lib/file-service";

/**
 * Optional book-cover upload. Stores only the StoredFile.id on the book — the
 * raw storageKey is never exposed. Cover is non-critical; failures never block
 * catalogue management (the book already exists before a cover is attached).
 */
export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; id: string }> }) {
  const { schoolId, id } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryCatalogueManage(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  const book = await prisma.libraryBook.findFirst({ where: { id, schoolId }, select: { id: true } });
  if (!book) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file is required" }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const uploaded = await uploadManagedFile({
    category: "LIBRARY_BOOK_COVER",
    schoolId,
    originalFilename: file.name || "cover",
    declaredContentType: file.type || undefined,
    bytes,
    uploader: { type: "USER", id: user.userId },
  });
  if (!uploaded.ok) return NextResponse.json({ error: uploaded.error }, { status: uploaded.status });

  await prisma.libraryBook.update({ where: { id }, data: { coverFileId: uploaded.file.id, updatedById: user.userId } });
  return NextResponse.json({ coverFileId: uploaded.file.id }, { status: 201 });
}
