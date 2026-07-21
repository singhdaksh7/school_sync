import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryCopyManage } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, unauthorized } from "@/lib/library/http";
import { serializeCopy } from "@/lib/library/serializers";
import { MANUAL_COPY_STATUSES } from "@/lib/library/constants";
import { logAudit } from "@/lib/audit";
import { recordLibraryHistory } from "@/lib/library/history";

const patchSchema = z.object({
  shelfLocation: z.string().trim().max(120).nullable().optional(),
  condition: z.string().trim().max(120).nullable().optional(),
  acquisitionCost: z.number().nonnegative().nullable().optional(),
  status: z.enum(MANUAL_COPY_STATUSES).optional(),
  statusReason: z.string().trim().max(500).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string; id: string }> }) {
  const { schoolId, id } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryCopyManage(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  const copy = await prisma.libraryBookCopy.findFirst({ where: { id, schoolId } });
  if (!copy) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const changingStatus = body.status && body.status !== copy.status;

  // A currently-issued copy cannot be reclassified directly — the loan must be
  // resolved first (return, or return-as-lost) via the loan return endpoint.
  if (changingStatus && copy.status === "ISSUED") {
    return NextResponse.json(
      { error: "Copy is on active loan; resolve the loan (return or mark lost) before changing its status", code: "COPY_ON_LOAN" },
      { status: 409 }
    );
  }
  if (changingStatus && copy.status === "RESERVED") {
    return NextResponse.json(
      { error: "Copy is held for a reservation; cancel the reservation before changing its status", code: "COPY_RESERVED" },
      { status: 409 }
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const data: Prisma.LibraryBookCopyUpdateInput = {};
    if (body.shelfLocation !== undefined) data.shelfLocation = body.shelfLocation;
    if (body.condition !== undefined) data.condition = body.condition;
    if (body.acquisitionCost !== undefined) data.acquisitionCost = body.acquisitionCost == null ? null : new Prisma.Decimal(body.acquisitionCost);
    if (changingStatus) {
      data.status = body.status;
      data.statusReason = body.statusReason ?? null;
      data.statusChangedAt = new Date();
      data.statusChangedById = user.userId;
    }
    const row = await tx.libraryBookCopy.update({ where: { id }, data });
    if (changingStatus) {
      await recordLibraryHistory(tx, {
        schoolId,
        event: "COPY_STATUS_CHANGED",
        bookId: copy.bookId,
        copyId: id,
        previousStatus: copy.status,
        newStatus: body.status,
        reason: body.statusReason ?? null,
        actorId: user.userId,
        actorRole: user.role,
      });
    }
    return row;
  });

  if (changingStatus) {
    await logAudit({
      action: "LIBRARY_COPY_STATUS_CHANGED",
      entityType: "LibraryBookCopy",
      entityId: id,
      userId: user.userId,
      schoolId,
      actorRole: user.role,
      metadata: { from: copy.status, to: body.status },
    });
  }

  return NextResponse.json(serializeCopy(updated));
}
