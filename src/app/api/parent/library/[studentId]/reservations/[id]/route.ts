import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { cancelReservation } from "@/lib/library/service";
import { libraryServiceError } from "@/lib/library/http";

/**
 * A parent may cancel a reservation their linked child placed (the one parent
 * write-action allowed in v1). Verified via StudentGuardian; anything else 404.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ studentId: string; id: string }> }) {
  const { studentId, id } = await params;
  const authed = await getAuthenticatedGuardian(req);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { guardian } = authed;

  const denied = await requireSchoolFeature(guardian.schoolId, "LIBRARY");
  if (denied) return denied;

  const canAccess = await guardianCanAccessStudent(guardian.id, guardian.schoolId, studentId);
  if (!canAccess) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The reservation must belong to this exact linked child.
  const own = await prisma.libraryReservation.findFirst({
    where: { id, schoolId: guardian.schoolId, studentId },
    select: { id: true },
  });
  if (!own) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await cancelReservation({
    schoolId: guardian.schoolId,
    reservationId: id,
    actor: { userId: guardian.id, role: "PARENT" },
    reason: "Cancelled by parent",
    skipAudit: true,
  });
  if (!result.ok) return libraryServiceError(result);
  return NextResponse.json(result.data);
}
