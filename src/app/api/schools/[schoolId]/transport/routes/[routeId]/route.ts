import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool, canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { logAudit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string; routeId: string }> }) {
  const { schoolId, routeId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "TRANSPORT");
    if (denied) return denied;
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "STANDARD_READ");
    if (denied) return denied;
  }

  const route = await prisma.route.findFirst({
    where: { id: routeId, schoolId },
    include: {
      vehicle: { select: { id: true, registrationNumber: true, capacity: true } },
      driver: { select: { id: true, name: true, phone: true } },
      // Per-stop student counts (aggregated via the relation's _count) —
      // the schema already supports this, it just wasn't being aggregated.
      stops: { orderBy: { sequence: "asc" }, include: { _count: { select: { studentAssignments: true } } } },
      studentAssignments: {
        include: {
          student: { select: { id: true, name: true, rollNo: true, section: { select: { name: true, class: { select: { name: true } } } } } },
          stop: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!route) return NextResponse.json({ error: "Route not found" }, { status: 404 });

  return NextResponse.json({
    ...route,
    stops: route.stops.map(({ _count, ...stop }) => ({ ...stop, studentCount: _count.studentAssignments })),
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string; routeId: string }> }) {
  const { schoolId, routeId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "TRANSPORT");
    if (denied) return denied;
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "MUTATION");
    if (denied) return denied;
  }

  const existing = await prisma.route.findFirst({ where: { id: routeId, schoolId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Route not found" }, { status: 404 });

  const body = await req.json();
  const data: { name?: string; description?: string | null; isActive?: boolean } = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Route name is required" }, { status: 400 });
    data.name = name;
  }
  if (body.description !== undefined) {
    data.description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  }
  if (body.isActive !== undefined) {
    data.isActive = Boolean(body.isActive);
  }

  const route = await prisma.route.update({ where: { id: routeId }, data });

  await logAudit({
    action: "TRANSPORT_ROUTE_UPDATED",
    entityType: "Route",
    entityId: route.id,
    userId: session.user.id,
    schoolId,
    actorRole: sessionRole(session.user),
  });

  return NextResponse.json(route);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ schoolId: string; routeId: string }> }) {
  const { schoolId, routeId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canWriteSchool(schoolId, session.user.id, sessionRole(session.user)))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "TRANSPORT");
    if (denied) return denied;
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "MUTATION");
    if (denied) return denied;
  }

  const route = await prisma.route.findFirst({ where: { id: routeId, schoolId }, select: { id: true } });
  if (!route) return NextResponse.json({ error: "Route not found" }, { status: 404 });

  await prisma.route.delete({ where: { id: routeId } });

  await logAudit({
    action: "TRANSPORT_ROUTE_DELETED",
    entityType: "Route",
    entityId: routeId,
    userId: session.user.id,
    schoolId,
    actorRole: sessionRole(session.user),
  });

  return NextResponse.json({ ok: true });
}
