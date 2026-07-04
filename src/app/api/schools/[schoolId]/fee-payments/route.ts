import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { logAudit } from "@/lib/audit";
import { moneyToNumber } from "@/lib/money";
import { canWriteSchool, sessionRole } from "@/lib/tenant";
import { requireSchoolAccess } from "@/lib/teacher-authorization";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { getClientIp } from "@/lib/request-ip";
import {
  MANUAL_FEE_PAYMENT_METHODS,
  calculateStudentFeeTotals,
  validateManualPaymentAmount,
} from "@/lib/student-fee-ledger";

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
  amount: z.coerce.number().positive(),
  method: z.enum(MANUAL_FEE_PAYMENT_METHODS),
  referenceNumber: z.string().trim().max(120).optional().nullable(),
  remarks: z.string().trim().max(500).optional().nullable(),
  paidAt: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ schoolId: string }> }) {
  const { schoolId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const role = sessionRole(session.user);
  const canWrite = await canWriteSchool(schoolId, session.user.id, role);
  if (!canWrite) {
    const teacherAccess = role === "TEACHER"
      ? await requireSchoolAccess(schoolId, session.user.id, role, "FEES", "RECORD_PAYMENT")
      : null;
    if (!teacherAccess || !teacherAccess.ok) {
      return teacherAccess?.response ?? NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  {
    const denied = await requireSchoolFeature(schoolId, "FEES");
    if (denied) return denied;
  }

  try {
    const body = await req.json();
    const data = createSchema.parse(body);
    const paidAt = data.paidAt ? new Date(data.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) {
      return NextResponse.json({ error: "Invalid payment date" }, { status: 400 });
    }

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

    const paidAggregate = await prisma.feePayment.aggregate({
      where: {
        schoolId,
        studentId: data.studentId,
        feeStructureId: data.feeStructureId,
        status: "PAID",
      },
      _sum: { amount: true },
    });
    const totalFee = moneyToNumber(feeStructure.amount);
    const paidTillDate = moneyToNumber(paidAggregate._sum.amount ?? 0);
    const totalsBefore = calculateStudentFeeTotals(totalFee, paidTillDate);

    const amountError = validateManualPaymentAmount(data.amount, totalsBefore.remainingAmount);
    if (amountError) {
      return NextResponse.json({ error: amountError }, { status: 400 });
    }

    const createdPayment = await prisma.feePayment.create({
      data: {
        studentId: data.studentId,
        feeStructureId: data.feeStructureId,
        amount: data.amount,
        method: data.method,
        referenceNumber: data.referenceNumber || null,
        notes: data.remarks || null,
        paidAt,
        recordedById: session.user.id,
        paymentGateway: null,
        status: "PAID",
        schoolId,
      },
      include: {
        student: { select: { name: true, rollNo: true } },
        feeStructure: { select: { name: true, amount: true } },
        recordedBy: { select: { name: true } },
      },
    });

    const updatedPayment = await prisma.feePayment.update({
      where: { id: createdPayment.id },
      data: { receiptNumber: createdPayment.receiptNumber ?? receiptNumber(createdPayment.id) },
      include: {
        student: {
          select: {
            name: true,
            rollNo: true,
            section: { select: { name: true, class: { select: { name: true } } } },
          },
        },
        feeStructure: { select: { name: true, amount: true } },
        recordedBy: { select: { name: true } },
      },
    });

    const totalsAfter = calculateStudentFeeTotals(totalFee, paidTillDate + data.amount);

    await logAudit({
      action: "FEE_PAYMENT_RECORDED",
      entityType: "FeePayment",
      entityId: updatedPayment.id,
      metadata: {
        studentName: updatedPayment.student.name,
        feeName: updatedPayment.feeStructure.name,
        amount: data.amount,
        method: data.method,
      },
      userId: session.user.id,
      schoolId,
      actorRole: role,
      ipAddress: getClientIp(req),
    });

    return NextResponse.json(
      {
        payment: serializePayment(updatedPayment),
        account: {
          studentId: data.studentId,
          feeStructureId: data.feeStructureId,
          totalFee: totalsAfter.totalFee,
          paidTillDate: totalsAfter.paidTillDate,
          remainingAmount: totalsAfter.remainingAmount,
          status: totalsAfter.status,
        },
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
