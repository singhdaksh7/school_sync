import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { cancelReservation } from "@/lib/library/service";
import { libraryServiceError } from "@/lib/library/http";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getStudentAuth(req);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const denied = await requireSchoolFeature(auth.schoolId, "LIBRARY");
  if (denied) return denied;

  const own = await prisma.libraryReservation.findFirst({
    where: { id, schoolId: auth.schoolId, studentId: auth.studentId },
    select: { id: true },
  });
  if (!own) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await cancelReservation({
    schoolId: auth.schoolId,
    reservationId: id,
    actor: { userId: auth.studentId, role: "STUDENT" },
    skipAudit: true,
  });
  if (!result.ok) return libraryServiceError(result);
  return NextResponse.json(result.data);
}
