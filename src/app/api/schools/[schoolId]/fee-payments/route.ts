import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { canAccessSchool, feeStructureBelongsToSchool, studentBelongsToSchool } from "@/lib/tenant";

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get("studentId");
  const feeStructureId = searchParams.get("feeStructureId");

  const payments = await prisma.feePayment.findMany({
    where: {
      schoolId,
      ...(studentId ? { studentId } : {}),
      ...(feeStructureId ? { feeStructureId } : {}),
    },
    include: {
      student: { select: { name: true, rollNo: true, section: { select: { name: true, class: { select: { name: true } } } } } },
      feeStructure: { select: { name: true, amount: true } },
      recordedBy: { select: { name: true } },
    },
    orderBy: { paidAt: "desc" },
  });
  return NextResponse.json(payments);
}

const createSchema = z.object({
  studentId: z.string(),
  feeStructureId: z.string(),
  amount: z.number().positive(),
  method: z.enum(["CASH", "ONLINE", "CHEQUE", "UPI"]).optional(),
  notes: z.string().optional(),
  paidAt: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await canAccessSchool(schoolId, session.user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const data = createSchema.parse(body);
    const [studentOk, feeStructureOk] = await Promise.all([
      studentBelongsToSchool(data.studentId, schoolId),
      feeStructureBelongsToSchool(data.feeStructureId, schoolId),
    ]);
    if (!studentOk) return NextResponse.json({ error: "Student not found in this school" }, { status: 400 });
    if (!feeStructureOk) return NextResponse.json({ error: "Fee structure not found in this school" }, { status: 400 });

    const payment = await prisma.feePayment.create({
      data: {
        studentId: data.studentId,
        feeStructureId: data.feeStructureId,
        amount: data.amount,
        method: data.method || null,
        notes: data.notes || null,
        paidAt: data.paidAt ? new Date(data.paidAt) : new Date(),
        recordedById: session.user.id,
        schoolId,
      },
      include: {
        student: { select: { name: true, rollNo: true } },
        feeStructure: { select: { name: true } },
        recordedBy: { select: { name: true } },
      },
    });
    await logAudit({ action: "FEE_PAYMENT_RECORDED", entityType: "FeePayment", entityId: payment.id, metadata: { studentName: payment.student.name, amount: payment.amount, feeName: payment.feeStructure.name }, userId: session.user.id, schoolId });
    return NextResponse.json(payment, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
