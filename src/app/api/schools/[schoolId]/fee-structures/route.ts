import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { canAccessSchool, classBelongsToSchool } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { moneyToNumber } from "@/lib/money";

export async function GET(_req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await requireSchoolFeature(schoolId, "FEES");
    if (denied) return denied;
  }

  const structures = await prisma.feeStructure.findMany({
    where: { schoolId },
    include: { class: { select: { name: true } } },
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
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  {
    const denied = await requireSchoolFeature(schoolId, "FEES");
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
      include: { class: { select: { name: true } } },
    });
    return NextResponse.json({ ...structure, amount: moneyToNumber(structure.amount) }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
