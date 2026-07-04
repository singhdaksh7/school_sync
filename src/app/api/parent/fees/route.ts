import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { moneyToNumber } from "@/lib/money";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { buildStudentFeeAccounts } from "@/lib/student-fee-ledger";

function withoutGatewayFields<
  T extends {
    gatewaySignature?: string | null;
    gatewayOrderId?: string | null;
    gatewayPaymentId?: string | null;
    paymentGateway?: string | null;
  },
>(payment: T) {
  const safePayment = { ...payment };
  delete safePayment.gatewaySignature;
  delete safePayment.gatewayOrderId;
  delete safePayment.gatewayPaymentId;
  delete safePayment.paymentGateway;
  return safePayment;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthenticatedGuardian(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    {
      const denied = await requireSchoolFeature(auth.guardian.schoolId, "FEES");
      if (denied) return denied;
    }

    const children = await prisma.student.findMany({
      where: {
        schoolId: auth.guardian.schoolId,
        guardianLinks: { some: { guardianId: auth.guardian.id, schoolId: auth.guardian.schoolId } },
      },
      include: { section: { include: { class: true } } },
      orderBy: { name: "asc" },
    });

    const studentIds = children.map((child) => child.id);
    const classIds = [...new Set(children.map((child) => child.section.classId))];

    const [feeStructures, payments] = await Promise.all([
      prisma.feeStructure.findMany({
        where: {
          schoolId: auth.guardian.schoolId,
          OR: [{ classId: null }, { classId: { in: classIds } }],
        },
        include: { class: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.feePayment.findMany({
        where: { schoolId: auth.guardian.schoolId, studentId: { in: studentIds } },
        include: { feeStructure: { select: { name: true, amount: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const serializedPayments = payments.map((payment) => {
      const safePayment = withoutGatewayFields(payment);
      return {
        ...safePayment,
        amount: moneyToNumber(payment.amount),
        feeStructure: {
          ...payment.feeStructure,
          amount: moneyToNumber(payment.feeStructure.amount),
        },
      };
    });

    const feeAccounts = buildStudentFeeAccounts({
      students: children.map((student) => ({
        id: student.id,
        name: student.name,
        rollNo: student.rollNo,
        section: {
          name: student.section.name,
          class: { id: student.section.class.id, name: student.section.class.name },
        },
      })),
      feeStructures: feeStructures.map((fee) => ({
        id: fee.id,
        name: fee.name,
        amount: moneyToNumber(fee.amount),
        frequency: fee.frequency,
        classId: fee.classId,
        class: fee.class ? { id: fee.class.id, name: fee.class.name } : null,
      })),
      payments: serializedPayments,
    });

    const pendingFees = feeAccounts
      .filter((account) => account.status !== "PAID")
      .map((account) => ({
        student: account.student,
        feeStructure: account.feeStructure,
        totalFee: account.totalFee,
        paidTillDate: account.paidTillDate,
        remainingAmount: account.remainingAmount,
        status: account.status,
      }));

    return NextResponse.json({
      children,
      feeAccounts,
      pendingFees,
      payments: serializedPayments,
    });
  } catch (error) {
    console.error("Parent fees error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
