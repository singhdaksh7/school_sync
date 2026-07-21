import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTeacherAuth } from "@/lib/mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { cancelReservation } from "@/lib/library/service";
import { libraryServiceError } from "@/lib/library/http";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getTeacherAuth(req);
  if (!auth || !auth.userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(auth.schoolId, "LIBRARY");
  if (denied) return denied;

  // Ownership: a teacher may only cancel their OWN reservation. Non-owned/other
  // reservations return 404 (no existence leak).
  const own = await prisma.libraryReservation.findFirst({
    where: { id, schoolId: auth.schoolId, teacherId: auth.teacherId },
    select: { id: true },
  });
  if (!own) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await cancelReservation({
    schoolId: auth.schoolId,
    reservationId: id,
    actor: { userId: auth.userId, role: "TEACHER" },
  });
  if (!result.ok) return libraryServiceError(result);
  return NextResponse.json(result.data);
}
