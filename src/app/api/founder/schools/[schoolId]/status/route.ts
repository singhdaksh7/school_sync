import { NextResponse } from "next/server";
import { requireFounderSession } from "@/lib/founder";
import { prisma } from "@/lib/prisma";
import { SCHOOL_STATUSES, type SchoolStatusValue } from "@/lib/school-status";

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const session = await requireFounderSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { schoolId } = await params;
  const body = await req.json().catch(() => null);
  const status = typeof body?.status === "string" ? body.status : "";

  if (!SCHOOL_STATUSES.includes(status as SchoolStatusValue)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const school = await prisma.school.update({
    where: { id: schoolId },
    data: { status: status as SchoolStatusValue },
  }).catch(() => null);

  if (!school) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ school });
}
