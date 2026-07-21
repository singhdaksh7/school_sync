import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSchoolAccessOrOperationalCapability } from "@/lib/operational-authorization";
import { resolveOperationsActor } from "@/lib/operations-bearer-auth";
import { parsePagination, paginated } from "@/lib/pagination";
import { requireSchoolFeature } from "@/lib/feature-flags";

/** Admin correction-request queue (pending by default). */
export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const actor = await resolveOperationsActor(req);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await requireSchoolAccessOrOperationalCapability(schoolId, actor.userId, actor.role, "ATTENDANCE", "VIEW", "ATTENDANCE_CORRECTION_VIEW");
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "ATTENDANCE");
    if (denied) return denied;
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") as "PENDING" | "APPROVED" | "REJECTED" | null;
  const { skip, take, page, limit } = parsePagination(searchParams);

  const where = { schoolId, ...(status ? { status } : {}) };
  const [requests, total] = await Promise.all([
    prisma.attendanceCorrectionRequest.findMany({
      where,
      include: {
        section: { select: { name: true, class: { select: { name: true } } } },
        requestedBy: { select: { name: true } },
        reviewedBy: { select: { name: true } },
        items: { include: { student: { select: { name: true, rollNo: true } } } },
      },
      orderBy: [{ createdAt: "desc" }],
      skip,
      take,
    }),
    prisma.attendanceCorrectionRequest.count({ where }),
  ]);

  return NextResponse.json(paginated(requests, total, { skip, take, page, limit }));
}
