import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sessionRole, canAccessSchool } from "@/lib/tenant";
import { parsePagination, paginated } from "@/lib/pagination";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { announcementInputSchema, createAnnouncement, isLeadershipRole, AnnouncementAuthError } from "@/lib/announcements";

/**
 * Leadership-only school announcement management (dashboard UI). Deliberately
 * NOT shared with the RBAC-permissioned teacher fallback that other
 * /api/schools/[schoolId]/* routes use (requireSchoolAccess) — that fallback
 * has no class-scoping concept of its own, and this route's
 * SCHOOL_OWNER/SCHOOL_ADMIN/VICE_PRINCIPAL-only gate must stay independent
 * of it. A teacher's announcement authority (see /api/teacher/announcements)
 * is layered from TWO independent checks: the standard ANNOUNCEMENTS module
 * permission (requireTeacherPermission — same mechanism HOMEWORK/ATTENDANCE
 * use) AND the classes/sections they actually teach (timetable/mentor
 * assignment) — a granted ANNOUNCEMENTS permission never by itself expands
 * which sections a teacher can target.
 */
async function requireLeadership(schoolId: string, userId: string, role: string | undefined) {
  if (!isLeadershipRole(role)) return null;
  if (!(await canAccessSchool(schoolId, userId))) return null;
  return role;
}

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = await requireLeadership(schoolId, session.user.id, sessionRole(session.user));
  if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "STANDARD_READ");
    if (denied) return denied;
  }

  const { searchParams } = new URL(req.url);
  const { skip, take, page, limit } = parsePagination(searchParams);
  const status = searchParams.get("status");
  const scope = searchParams.get("scope");
  const audience = searchParams.get("audience");
  const classId = searchParams.get("classId");
  const sectionId = searchParams.get("sectionId");
  const creatorId = searchParams.get("creatorId");
  const search = searchParams.get("search");

  const where = {
    schoolId,
    ...(status ? { status: status as never } : {}),
    ...(scope ? { scope: scope as never } : {}),
    ...(creatorId ? { createdById: creatorId } : {}),
    ...(audience ? { audience: { some: { group: audience as never } } } : {}),
    ...(sectionId ? { targets: { some: { sectionId } } } : classId ? { targets: { some: { classId } } } : {}),
    ...(search ? { OR: [{ title: { contains: search, mode: "insensitive" as const } }, { body: { contains: search, mode: "insensitive" as const } }] } : {}),
  };

  const [data, total, summary] = await Promise.all([
    prisma.announcement.findMany({
      where,
      include: {
        createdBy: { select: { name: true, role: true } },
        audience: true,
        targets: { include: { class: { select: { name: true } }, section: { select: { name: true } } } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take,
    }),
    prisma.announcement.count({ where }),
    prisma.announcement.groupBy({ by: ["status"], where: { schoolId }, _count: { _all: true } }),
  ]);

  const counts = { DRAFT: 0, SCHEDULED: 0, PUBLISHED: 0, ARCHIVED: 0, CANCELLED: 0 } as Record<string, number>;
  for (const row of summary) counts[row.status] = row._count._all;

  return NextResponse.json({ ...paginated(data, total, { skip, take, page, limit }), summary: counts });
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = await requireLeadership(schoolId, session.user.id, sessionRole(session.user));
  if (!role) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "MUTATION");
    if (denied) return denied;
  }

  try {
    const body = await req.json();
    const data = announcementInputSchema.parse(body);
    const announcement = await createAnnouncement({ actorKind: "LEADERSHIP", userId: session.user.id, role, schoolId }, data);
    return NextResponse.json(announcement, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (err instanceof AnnouncementAuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("Create announcement error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
