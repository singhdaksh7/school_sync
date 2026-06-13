import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { normalizePhone } from "@/lib/parent-auth";
import { prisma } from "@/lib/prisma";
import { allStudentsBelongToSchool, canAccessSchool, hasPrismaErrorCode, sessionRole } from "@/lib/tenant";

const guardianSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(5),
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().min(8).optional().or(z.literal("")),
  studentIds: z.array(z.string().min(1)).min(1),
  relationType: z.string().min(2).default("GUARDIAN"),
  isPrimary: z.boolean().default(false),
});

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const guardians = await prisma.guardian.findMany({
    where: { schoolId },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      passwordHash: true,
      studentLinks: {
        select: {
          relationType: true,
          isPrimary: true,
          student: {
            select: {
              id: true,
              name: true,
              rollNo: true,
              section: { select: { name: true, class: { select: { name: true } } } },
            },
          },
        },
      },
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(
    guardians.map(({ passwordHash, ...guardian }) => ({
      ...guardian,
      hasPassword: Boolean(passwordHash),
    }))
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (sessionRole(session.user) === "VICE_PRINCIPAL") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const data = guardianSchema.parse(await req.json());
    const studentIds = [...new Set(data.studentIds)];

    if (!(await allStudentsBelongToSchool(studentIds, schoolId))) {
      return NextResponse.json({ error: "One or more students were not found in this school" }, { status: 400 });
    }

    const passwordHash = data.password ? await bcrypt.hash(data.password, 12) : undefined;
    const phone = normalizePhone(data.phone);
    if (!phone) return NextResponse.json({ error: "A valid phone number is required" }, { status: 400 });

    const guardian = await prisma.guardian.upsert({
      where: { schoolId_phone: { schoolId, phone } },
      create: {
        schoolId,
        name: data.name,
        phone,
        email: data.email || null,
        passwordHash,
      },
      update: {
        name: data.name,
        email: data.email || null,
        ...(passwordHash ? { passwordHash } : {}),
      },
      select: { id: true, name: true, phone: true, email: true, schoolId: true },
    });

    await prisma.studentGuardian.createMany({
      data: studentIds.map((studentId) => ({
        schoolId,
        studentId,
        guardianId: guardian.id,
        relationType: data.relationType,
        isPrimary: data.isPrimary,
      })),
      skipDuplicates: true,
    });

    await logAudit({
      action: "GUARDIAN_UPSERTED",
      entityType: "Guardian",
      entityId: guardian.id,
      metadata: { name: guardian.name, phone: guardian.phone, studentIds },
      userId: session.user.id,
      schoolId,
    });

    return NextResponse.json({ guardian, linkedStudentIds: studentIds }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    if (hasPrismaErrorCode(err, "P2002")) return NextResponse.json({ error: "Guardian link already exists" }, { status: 400 });
    console.error("Create guardian error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
