import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { moneyToNumber } from "@/lib/money";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { buildStudentFeeAccounts } from "@/lib/student-fee-ledger";

export async function GET(req: NextRequest) {
  try {
    const auth = await getStudentAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const featureDenied = await requireSchoolFeature(auth.schoolId, "FEES");
    if (featureDenied) return featureDenied;

    const rateDenied = await enforceActorRateLimit(
      { schoolId: auth.schoolId, actorType: "STUDENT", actorId: auth.studentId },
      "STANDARD_READ"
    );
    if (rateDenied) return rateDenied;

    const student = await prisma.student.findFirst({
      where: { id: auth.studentId, schoolId: auth.schoolId },
      include: { section: { include: { class: true } } },
    });
    if (!student) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [feeStructures, payments] = await Promise.all([
      prisma.feeStructure.findMany({
        where: {
          schoolId: auth.schoolId,
          OR: [{ classId: null }, { classId: student.section.classId }],
        },
        include: { class: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.feePayment.findMany({
        where: { schoolId: auth.schoolId, studentId: auth.studentId },
        select: {
          id: true,
          amount: true,
          method: true,
          paidAt: true,
          referenceNumber: true,
          receiptNumber: true,
          status: true,
          studentId: true,
          feeStructureId: true,
          createdAt: true,
          feeStructure: { select: { name: true, amount: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const serializedPayments = payments.map((payment) => ({
      ...payment,
      amount: moneyToNumber(payment.amount),
      feeStructure: {
        ...payment.feeStructure,
        amount: moneyToNumber(payment.feeStructure.amount),
      },
    }));

    const feeAccounts = buildStudentFeeAccounts({
      students: [
        {
          id: student.id,
          name: student.name,
          rollNo: student.rollNo,
          section: {
            name: student.section.name,
            class: { id: student.section.class.id, name: student.section.class.name },
          },
        },
      ],
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
      feeAccounts,
      pendingFees,
      payments: serializedPayments,
    });
  } catch (error) {
    console.error("Student fees error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
