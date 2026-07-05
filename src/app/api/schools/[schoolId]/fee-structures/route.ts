import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { canWriteSchool, classBelongsToSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { moneyToNumber } from "@/lib/money";
import { requireSchoolAccess } from "@/lib/teacher-authorization";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/request-ip";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireSchoolAccess(schoolId, session.user.id, sessionRole(session.user), "FEES", "VIEW");
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "FEES");
    if (denied) return denied;
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "STANDARD_READ");
    if (denied) return denied;
  }

  const structures = await prisma.feeStructure.findMany({
    where: { schoolId },
    include: { class: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(structures.map((structure) => ({ ...structure, amount: moneyToNumber(structure.amount) })));
}

const createSchema = z.object({
  name: z.string().min(1),
  amount: z.number().positive(),
  frequency: z.enum(["ANNUAL", "MONTHLY", "QUARTERLY", "ONE_TIME"]),
  classId: z.string().optional().nullable(),
});

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  if (!(await canWriteSchool(schoolId, session.user.id, role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  {
    const denied = await requireSchoolFeature(schoolId, "FEES");
    if (denied) return denied;
  }
  {
    const denied = await enforceActorRateLimit({ schoolId, actorType: "ADMIN_STAFF", actorId: session.user.id }, "MUTATION");
    if (denied) return denied;
  }

  try {
    const body = await req.json();
    const data = createSchema.parse(body);
    if (data.classId && !(await classBelongsToSchool(data.classId, schoolId))) {
      return NextResponse.json({ error: "Class not found in this school" }, { status: 400 });
    }

    const structure = await prisma.feeStructure.create({
      data: {
        name: data.name,
        amount: data.amount,
        frequency: data.frequency,
        classId: data.classId || null,
        schoolId,
      },
      include: { class: { select: { id: true, name: true } } },
    });
    await logAudit({
      action: "FEE_STRUCTURE_CREATED",
      entityType: "FeeStructure",
      entityId: structure.id,
      metadata: {
        name: structure.name,
        amount: moneyToNumber(structure.amount),
        frequency: structure.frequency,
      },
      userId: session.user.id,
      schoolId,
      actorRole: role,
      ipAddress: getClientIp(req),
    });
    return NextResponse.json({ ...structure, amount: moneyToNumber(structure.amount) }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
