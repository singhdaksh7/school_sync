import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, hasPrismaErrorCode, sessionRole } from "@/lib/tenant";
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
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Stop name is required" }, { status: 400 });
  const latitude = typeof body.latitude === "number" ? body.latitude : null;
  const longitude = typeof body.longitude === "number" ? body.longitude : null;

  // Auto-assign the next sequence number unless the caller explicitly orders
  // this stop, so admins can append stops without tracking the count.
  let sequence: number;
  if (typeof body.sequence === "number" && Number.isInteger(body.sequence)) {
    sequence = body.sequence;
  } else {
    const last = await prisma.stop.findFirst({ where: { routeId }, orderBy: { sequence: "desc" }, select: { sequence: true } });
    sequence = (last?.sequence ?? 0) + 1;
  }

  try {
    const stop = await prisma.stop.create({
      data: { schoolId, routeId, name, sequence, latitude, longitude },
    });

    await logAudit({
      action: "TRANSPORT_STOP_CREATED",
      entityType: "Stop",
      entityId: stop.id,
      userId: session.user.id,
      schoolId,
      actorRole: sessionRole(session.user),
      metadata: { routeId, name: stop.name, sequence: stop.sequence },
    });

    return NextResponse.json(stop, { status: 201 });
  } catch (err) {
    if (hasPrismaErrorCode(err, "P2002")) {
      return NextResponse.json({ error: "A stop with that sequence number already exists on this route", code: "DUPLICATE_SEQUENCE" }, { status: 409 });
    }
    throw err;
  }
}
