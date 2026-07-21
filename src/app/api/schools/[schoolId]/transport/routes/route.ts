import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool, canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { logAudit } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
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

  const routes = await prisma.route.findMany({
    where: { schoolId },
    include: {
      vehicle: { select: { id: true, registrationNumber: true } },
      driver: { select: { id: true, name: true, phone: true } },
      _count: { select: { stops: true, studentAssignments: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(routes);
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
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

  const body = await req.json();
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" && body.description.trim() ? body.description.trim() : null;
  if (!name) return NextResponse.json({ error: "Route name is required" }, { status: 400 });

  const route = await prisma.route.create({
    data: { schoolId, name, description },
  });

  await logAudit({
    action: "TRANSPORT_ROUTE_CREATED",
    entityType: "Route",
    entityId: route.id,
    userId: session.user.id,
    schoolId,
    actorRole: sessionRole(session.user),
    metadata: { name: route.name },
  });

  return NextResponse.json(route, { status: 201 });
}
