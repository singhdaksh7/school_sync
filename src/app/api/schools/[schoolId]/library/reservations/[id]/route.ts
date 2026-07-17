import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { requireLibraryReservationManage } from "@/lib/library/authorization";
import { resolveLibraryStaffUser, libraryServiceError, unauthorized } from "@/lib/library/http";
import { cancelReservation } from "@/lib/library/service";

const schema = z.object({ reason: z.string().trim().max(500).optional() });

export async function DELETE(req: Request, { params }: { params: Promise<{ schoolId: string; id: string }> }) {
  const { schoolId, id } = await params;
  const user = await resolveLibraryStaffUser(req);
  if (!user) return unauthorized();
  const access = await requireLibraryReservationManage(schoolId, user.userId);
  if (!access.ok) return access.response;
  const denied = await requireSchoolFeature(schoolId, "LIBRARY");
  if (denied) return denied;

  let reason: string | undefined;
  try {
    const raw = await req.text();
    reason = raw ? schema.parse(JSON.parse(raw)).reason : undefined;
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const result = await cancelReservation({
    schoolId,
    reservationId: id,
    actor: { userId: user.userId, role: user.role },
    reason: reason ?? null,
  });
  if (!result.ok) return libraryServiceError(result);
  return NextResponse.json(result.data);
}
