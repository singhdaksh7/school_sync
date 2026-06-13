import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { moneyToNumber } from "@/lib/money";
import { getAuthenticatedGuardian } from "@/lib/parent-auth";

function withoutGatewaySignature<T extends { gatewaySignature?: string | null }>(payment: T) {
  const safePayment = { ...payment };
  delete safePayment.gatewaySignature;
  return safePayment;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthenticatedGuardian(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

    const paidKeys = new Set(
      payments
        .filter((payment) => payment.status === "PAID")
        .map((payment) => `${payment.studentId}:${payment.feeStructureId}`)
    );

    const pendingFees = children.flatMap((student) =>
      feeStructures
        .filter((fee) => !fee.classId || fee.classId === student.section.classId)
        .filter((fee) => !paidKeys.has(`${student.id}:${fee.id}`))
        .map((fee) => ({
          student: {
            id: student.id,
            name: student.name,
            rollNo: student.rollNo,
            section: {
              name: student.section.name,
              class: { name: student.section.class.name },
            },
          },
          feeStructure: {
            id: fee.id,
            name: fee.name,
            amount: moneyToNumber(fee.amount),
            frequency: fee.frequency,
            class: fee.class,
          },
        }))
    );

    return NextResponse.json({
      children,
      pendingFees,
      payments: payments.map((payment) => {
        const safePayment = withoutGatewaySignature(payment);
        return {
        ...safePayment,
        amount: moneyToNumber(payment.amount),
        feeStructure: {
          ...payment.feeStructure,
          amount: moneyToNumber(payment.feeStructure.amount),
        },
        };
      }),
    });
  } catch (error) {
    console.error("Parent fees error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
