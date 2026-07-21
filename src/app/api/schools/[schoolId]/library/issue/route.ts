import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryIssue } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, libraryServiceError, getSchoolTimezone, unauthorized } from "@/lib/library/http";
import { issueLoan } from "@/lib/library/service";

const schema = z
  .object({
    copyId: z.string().trim().optional(),
    barcode: z.string().trim().optional(),
    accessionNumber: z.string().trim().optional(),
    borrowerType: z.enum(["STUDENT", "TEACHER"]),
    borrowerId: z.string().trim().min(1),
  })
  .refine((v) => v.copyId || v.barcode || v.accessionNumber, {
    message: "Provide a copyId, barcode, or accessionNumber",
  });

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryIssue(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Resolve the physical copy within this tenant (barcode/accession are the
  // USB-scanner inputs; all lookups are schoolId-scoped).
  const copy = await prisma.libraryBookCopy.findFirst({
    where: {
      schoolId,
      ...(body.copyId ? { id: body.copyId } : {}),
      ...(body.barcode ? { barcode: body.barcode } : {}),
      ...(body.accessionNumber ? { accessionNumber: body.accessionNumber } : {}),
    },
    select: { id: true },
  });
  if (!copy) return NextResponse.json({ error: "Copy not found", code: "NOT_FOUND" }, { status: 404 });

  const timezone = await getSchoolTimezone(schoolId);
  const result = await issueLoan({
    schoolId,
    copyId: copy.id,
    borrower: { type: body.borrowerType, id: body.borrowerId },
    actor: { userId: user.userId, role: user.role },
    timezone,
  });
  if (!result.ok) return libraryServiceError(result);
  return NextResponse.json(result.data, { status: 201 });
}
