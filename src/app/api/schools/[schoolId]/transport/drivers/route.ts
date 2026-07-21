import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAccessSchool, canWriteSchool, hasPrismaErrorCode, sessionRole } from "@/lib/tenant";
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

  const drivers = await prisma.driver.findMany({
    where: { schoolId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      licenseNumber: true,
      isActive: true,
      passwordHash: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { routes: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(
    drivers.map(({ passwordHash, ...driver }) => ({
      ...driver,
      hasPassword: Boolean(passwordHash),
    }))
  );
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
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!name) return NextResponse.json({ error: "Driver name is required" }, { status: 400 });
  if (!phone) return NextResponse.json({ error: "Driver phone is required" }, { status: 400 });
  const email = typeof body.email === "string" && body.email.trim() ? body.email.trim() : null;
  const licenseNumber = typeof body.licenseNumber === "string" && body.licenseNumber.trim() ? body.licenseNumber.trim() : null;
  // Not used for login until Phase B (driver auth); settable here so the
  // credential can be provisioned ahead of that rollout.
  const passwordHash = typeof body.password === "string" && body.password.length >= 8 ? await bcrypt.hash(body.password, 12) : null;

  try {
    const driver = await prisma.driver.create({
      data: { schoolId, name, phone, email, licenseNumber, passwordHash },
      select: { id: true, name: true, phone: true, email: true, licenseNumber: true, isActive: true },
    });

    await logAudit({
      action: "TRANSPORT_DRIVER_CREATED",
      entityType: "Driver",
      entityId: driver.id,
      userId: session.user.id,
      schoolId,
      actorRole: sessionRole(session.user),
      metadata: { name: driver.name, phone: driver.phone },
    });

    return NextResponse.json(driver, { status: 201 });
  } catch (err) {
    if (hasPrismaErrorCode(err, "P2002")) {
      return NextResponse.json({ error: "A driver with that phone number already exists", code: "DUPLICATE_PHONE" }, { status: 409 });
    }
    throw err;
  }
}
