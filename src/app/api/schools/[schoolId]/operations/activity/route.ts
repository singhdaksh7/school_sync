import { NextResponse } from "next/server";
import { guardOperationsCapability } from "@/lib/operations-route-guard";
import { resolveSchoolTodayDateOnly } from "@/lib/operations-context";
import { loadTodayActivityTimeline, DEFAULT_ACTIVITY_LIMIT } from "@/lib/operations-activity";
import { parsePagination, buildPaginationMeta } from "@/lib/pagination";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const guarded = await guardOperationsCapability(req, schoolId, "STANDARD_READ", "OPERATIONS_TODAY_VIEW", false);
  if (!guarded.ok) return guarded.deny;

  const { searchParams } = new URL(req.url);
  const page = parsePagination(searchParams, { defaultLimit: DEFAULT_ACTIVITY_LIMIT, maxLimit: 100 });

  const dateOnly = await resolveSchoolTodayDateOnly(schoolId);
  const { data, total } = await loadTodayActivityTimeline(schoolId, dateOnly, { skip: page.skip, take: page.take });

  return NextResponse.json({ data, pagination: buildPaginationMeta(total, page.page, page.limit) });
}
