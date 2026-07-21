import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, sessionRole, studentBelongsToSchool } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { logAudit } from "@/lib/audit";

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string; routeId: string }> }) {
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

  const body = await req.json();
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  if (!studentId) return NextResponse.json({ error: "studentId is required" }, { status: 400 });
  if (!(await studentBelongsToSchool(studentId, schoolId))) {
    return NextResponse.json({ error: "Student not found in this school" }, { status: 400 });
  }

  let stopId: string | null = null;
  if (body.stopId !== undefined && body.stopId !== null) {
    if (typeof body.stopId !== "string") return NextResponse.json({ error: "Invalid stopId" }, { status: 400 });
    const stop = await prisma.stop.findFirst({ where: { id: body.stopId, routeId }, select: { id: true } });
    if (!stop) return NextResponse.json({ error: "Stop does not belong to this route" }, { status: 400 });
    stopId = stop.id;
  }

  const assignment = await prisma.studentRouteAssignment.upsert({
    where: { studentId_routeId: { studentId, routeId } },
    create: { schoolId, studentId, routeId, stopId },
    update: { stopId },
    include: { student: { select: { id: true, name: true, rollNo: true } }, stop: { select: { id: true, name: true } } },
  });

  await logAudit({
    action: "TRANSPORT_STUDENT_ASSIGNMENT_CHANGED",
    entityType: "StudentRouteAssignment",
    entityId: assignment.id,
    userId: session.user.id,
    schoolId,
    actorRole: sessionRole(session.user),
    metadata: { routeId, studentId, stopId, action: "ASSIGNED" },
  });

  return NextResponse.json(assignment, { status: 201 });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ schoolId: string; routeId: string }> }) {
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

  const body = await req.json().catch(() => ({}));
  const studentId = typeof body.studentId === "string" ? body.studentId : "";
  if (!studentId) return NextResponse.json({ error: "studentId is required" }, { status: 400 });

  const existing = await prisma.studentRouteAssignment.findUnique({
    where: { studentId_routeId: { studentId, routeId } },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Student is not assigned to this route" }, { status: 404 });

  await prisma.studentRouteAssignment.delete({ where: { id: existing.id } });

  await logAudit({
    action: "TRANSPORT_STUDENT_ASSIGNMENT_CHANGED",
    entityType: "StudentRouteAssignment",
    entityId: existing.id,
    userId: session.user.id,
    schoolId,
    actorRole: sessionRole(session.user),
    metadata: { routeId, studentId, action: "UNASSIGNED" },
  });

  return NextResponse.json({ ok: true });
}
