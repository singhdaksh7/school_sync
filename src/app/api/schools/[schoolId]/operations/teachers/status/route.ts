import { NextResponse } from "next/server";
import { guardOperationsCapability } from "@/lib/operations-route-guard";
import { loadTodayOperationsContext } from "@/lib/operations-context";
import {
  computeTeacherTodayStatuses,
  summarizeTeacherStatuses,
  filterAndPaginateTeacherStatuses,
  type TeacherStatusFilter,
} from "@/lib/operations-teacher-status";
import { bulkSetTeacherDailyStatus, type TeacherStatusUpdateInput } from "@/lib/teacher-daily-status";
import { buildDelegatedAuditMetadata } from "@/lib/operational-audit";
import { parsePagination, buildPaginationMeta } from "@/lib/pagination";

const VALID_FILTERS: readonly TeacherStatusFilter[] = ["PRESENT", "ABSENT", "ON_LEAVE", "NOT_MARKED", "IN_CLASS", "FREE", "ALL"];

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const guarded = await guardOperationsCapability(schoolId, "STANDARD_READ", "TEACHER_STATUS_VIEW", false);
  if (!guarded.ok) return guarded.deny;

  const { searchParams } = new URL(req.url);
  const filterParam = searchParams.get("filter");
  const filter: TeacherStatusFilter = VALID_FILTERS.includes(filterParam as TeacherStatusFilter) ? (filterParam as TeacherStatusFilter) : "ALL";
  const search = searchParams.get("search") ?? undefined;
  const page = parsePagination(searchParams, { defaultLimit: 50, maxLimit: 100 });

  const ctx = await loadTodayOperationsContext(schoolId);
  const statuses = computeTeacherTodayStatuses(ctx);
  const summary = summarizeTeacherStatuses(statuses);
  const { data, total } = filterAndPaginateTeacherStatuses(statuses, { filter, search, skip: page.skip, take: page.take });

  return NextResponse.json({ summary, data, pagination: buildPaginationMeta(total, page.page, page.limit) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const guarded = await guardOperationsCapability(schoolId, "MUTATION", "TEACHER_ATTENDANCE_MANAGE", true);
  if (!guarded.ok) return guarded.deny;

  const body = await req.json().catch(() => null);
  const updates = body?.updates;
  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: "updates array is required" }, { status: 400 });
  }
  const parsedUpdates: TeacherStatusUpdateInput[] = [];
  for (const u of updates) {
    if (typeof u?.teacherId !== "string" || (u.status !== "PRESENT" && u.status !== "ABSENT")) {
      return NextResponse.json({ error: "Each update requires teacherId and status of PRESENT or ABSENT" }, { status: 400 });
    }
    parsedUpdates.push({ teacherId: u.teacherId, status: u.status });
  }

  const ctx = await loadTodayOperationsContext(schoolId);
  const result = await bulkSetTeacherDailyStatus({
    schoolId,
    dateOnly: ctx.dateOnly,
    updates: parsedUpdates,
    markedById: guarded.ctx.userId,
    actorRole: guarded.ctx.role,
    delegatedAudit:
      guarded.ctx.teacherId && guarded.ctx.operational ? buildDelegatedAuditMetadata(guarded.ctx.teacherId, guarded.ctx.operational) : undefined,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ results: result.results });
}
