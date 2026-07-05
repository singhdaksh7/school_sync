import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canAccessSchool } from "@/lib/tenant";
import { parsePagination, buildPaginationMeta } from "@/lib/pagination";
import { listJobsForSchool } from "@/lib/jobs";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import type { JobType } from "@/generated/prisma/client";

const JOB_TYPES = new Set(["REPORT_CARD_BATCH_GENERATION", "STUDENT_BULK_IMPORT", "SMART_TIMETABLE_GENERATION"]);

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "JOB_STATUS");
    if (denied) return denied;
  }

  const { searchParams } = new URL(req.url);
  const typeParam = searchParams.get("type");
  const type = typeParam && JOB_TYPES.has(typeParam) ? (typeParam as JobType) : undefined;
  const page = parsePagination(searchParams, { defaultLimit: 25, maxLimit: 100 });

  const [jobs, total] = await listJobsForSchool(schoolId, { skip: page.skip, take: page.take, type });
  return NextResponse.json({ data: jobs, pagination: buildPaginationMeta(total, page.page, page.limit) });
}
