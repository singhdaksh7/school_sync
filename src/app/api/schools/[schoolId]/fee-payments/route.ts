import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { moneyToNumber } from "@/lib/money";
import { canAccessSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolAccess } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { getClientIp } from "@/lib/request-ip";

function serializePayment<T extends { amount: unknown; feeStructure?: { amount: unknown } | null; gatewaySignature?: string | null }>(payment: T) {
  const safePayment = { ...payment };
  delete safePayment.gatewaySignature;
  return {
    ...safePayment,
    amount: moneyToNumber(payment.amount as { toString(): string }),
    feeStructure: payment.feeStructure
      ? { ...payment.feeStructure, amount: moneyToNumber(payment.feeStructure.amount as { toString(): string }) }
      : payment.feeStructure,
  };
}

function receiptNumber(paymentId: string) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `SS-${date}-${paymentId.slice(-8).toUpperCase()}`;
}

export async function GET(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const access = await requireSchoolAccess(schoolId, session.user.id, sessionRole(session.user), "FEES", "VIEW");
  if (!access.ok) return access.response;
  {
    const denied = await requireSchoolFeature(schoolId, "FEES");
    if (denied) return denied;
  }

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
  return NextResponse.json(payments.map(serializePayment));
}

const createSchema = z.object({
  studentId: z.string(),
  feeStructureId: z.string(),
  amount: z.number().positive().optional(),
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
    const [student, feeStructure] = await Promise.all([
      prisma.student.findFirst({
        where: { id: data.studentId, schoolId },
        include: { section: { select: { classId: true } } },
      }),
      prisma.feeStructure.findFirst({
        where: { id: data.feeStructureId, schoolId },
      }),
    ]);
    if (!student) return NextResponse.json({ error: "Student not found in this school" }, { status: 400 });
    if (!feeStructure) return NextResponse.json({ error: "Fee structure not found in this school" }, { status: 400 });
    if (feeStructure.classId && feeStructure.classId !== student.section.classId) {
      return NextResponse.json({ error: "Fee structure does not apply to this student's class" }, { status: 400 });
    }

    const payment = await prisma.feePayment.create({
      data: {
        studentId: data.studentId,
        feeStructureId: data.feeStructureId,
        amount: feeStructure.amount,
        method: data.method || null,
        notes: data.notes || null,
        paidAt: data.paidAt ? new Date(data.paidAt) : new Date(),
        recordedById: session.user.id,
        paymentGateway: null,
        status: "PAID",
        schoolId,
      },
      include: {
        student: { select: { name: true, rollNo: true } },
        feeStructure: { select: { name: true } },
        recordedBy: { select: { name: true } },
      },
    });
    const updatedPayment = await prisma.feePayment.update({
      where: { id: payment.id },
      data: { receiptNumber: receiptNumber(payment.id) },
      include: {
        student: { select: { name: true, rollNo: true } },
        feeStructure: { select: { name: true, amount: true } },
        recordedBy: { select: { name: true } },
      },
    });
    await logAudit({ action: "FEE_PAYMENT_RECORDED", entityType: "FeePayment", entityId: payment.id, metadata: { studentName: payment.student.name, amount: moneyToNumber(feeStructure.amount), feeName: payment.feeStructure.name }, userId: session.user.id, schoolId, actorRole: sessionRole(session.user), ipAddress: getClientIp(req) });
    return NextResponse.json(serializePayment(updatedPayment), { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
