import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryRead } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, getSchoolTimezone, unauthorized } from "@/lib/library/http";
import { serializeCopy, serializeBook, serializeLoan } from "@/lib/library/serializers";

/**
 * Scanner lookup: resolve a copy by barcode or accession number (the USB-HID
 * scanner types into a text field + Enter). Returns the copy, its title, and any
 * current active loan so the issue/return screen can branch. Tenant-scoped.
 */
export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryRead(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  const url = new URL(req.url);
  const code = url.searchParams.get("code")?.trim();
  if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 });

  const copy = await prisma.libraryBookCopy.findFirst({
    where: { schoolId, OR: [{ barcode: code }, { accessionNumber: code }] },
    include: { book: true, loans: { where: { status: "ACTIVE" }, include: { bookCopy: { include: { book: true } } }, take: 1 } },
  });
  if (!copy) return NextResponse.json({ error: "Copy not found", code: "NOT_FOUND" }, { status: 404 });

  const timezone = await getSchoolTimezone(schoolId);
  return NextResponse.json({
    copy: serializeCopy(copy),
    book: serializeBook(copy.book),
    activeLoan: copy.loans[0] ? serializeLoan(copy.loans[0], { timezone }) : null,
  });
}
