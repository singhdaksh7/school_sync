import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canWriteSchool, hasPrismaErrorCode, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { logAudit } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: Promise<{ schoolId: string; driverId: string }> }) {
  const { schoolId, driverId } = await params;
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

  const existing = await prisma.driver.findFirst({ where: { id: driverId, schoolId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Driver not found" }, { status: 404 });

  const body = await req.json();
  const data: {
    name?: string;
    phone?: string;
    email?: string | null;
    licenseNumber?: string | null;
    isActive?: boolean;
    passwordHash?: string;
  } = {};

  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "Driver name is required" }, { status: 400 });
    data.name = name;
  }
  if (body.phone !== undefined) {
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!phone) return NextResponse.json({ error: "Driver phone is required" }, { status: 400 });
    data.phone = phone;
  }
  if (body.email !== undefined) {
    data.email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null;
  }
  if (body.licenseNumber !== undefined) {
    data.licenseNumber = typeof body.licenseNumber === "string" && body.licenseNumber.trim() ? body.licenseNumber.trim() : null;
  }
  if (body.isActive !== undefined) {
    data.isActive = Boolean(body.isActive);
  }
  if (typeof body.password === "string" && body.password.length >= 8) {
    data.passwordHash = await bcrypt.hash(body.password, 12);
  }

  try {
    const driver = await prisma.driver.update({
      where: { id: driverId },
      data,
      select: { id: true, name: true, phone: true, email: true, licenseNumber: true, isActive: true },
    });

    await logAudit({
      action: "TRANSPORT_DRIVER_UPDATED",
      entityType: "Driver",
      entityId: driver.id,
      userId: session.user.id,
      schoolId,
      actorRole: sessionRole(session.user),
    });

    return NextResponse.json(driver);
  } catch (err) {
    if (hasPrismaErrorCode(err, "P2002")) {
      return NextResponse.json({ error: "A driver with that phone number already exists", code: "DUPLICATE_PHONE" }, { status: 409 });
    }
    throw err;
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ schoolId: string; driverId: string }> }) {
  const { schoolId, driverId } = await params;
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

  const driver = await prisma.driver.findFirst({ where: { id: driverId, schoolId }, select: { id: true } });
  if (!driver) return NextResponse.json({ error: "Driver not found" }, { status: 404 });

  const assignedRoutes = await prisma.route.count({ where: { schoolId, driverId } });
  if (assignedRoutes > 0) {
    return NextResponse.json(
      { error: "Unassign this driver from every route before deleting it", code: "DRIVER_IN_USE" },
      { status: 409 }
    );
  }

  await prisma.driver.delete({ where: { id: driverId } });

  await logAudit({
    action: "TRANSPORT_DRIVER_DELETED",
    entityType: "Driver",
    entityId: driverId,
    userId: session.user.id,
    schoolId,
    actorRole: sessionRole(session.user),
  });

  return NextResponse.json({ ok: true });
}
