import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { moneyToNumber, paiseFromRupees } from "@/lib/money";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { createRazorpayOrder, getRazorpayConfig } from "@/lib/razorpay";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { getClientIp } from "@/lib/request-ip";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";

const schema = z.object({
  studentId: z.string().min(1),
  feeStructureId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthenticatedGuardian(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const limit = await rateLimit(`payment-order:${getClientIp(req) ?? auth.guardian.id}`, RATE_LIMIT_POLICIES.payment);
    if (!limit.allowed) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });

    const featureDenied = await requireSchoolFeature(auth.guardian.schoolId, "FEES");
    if (featureDenied) return featureDenied;

    const data = schema.parse(await req.json());
    if (!(await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, data.studentId))) {
      return NextResponse.json({ error: "Student not found" }, { status: 404 });
    }

    const student = await prisma.student.findFirst({
      where: { id: data.studentId, schoolId: auth.guardian.schoolId },
      include: { section: { select: { classId: true } } },
    });
    if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });

    const feeStructure = await prisma.feeStructure.findFirst({
      where: {
        id: data.feeStructureId,
        schoolId: auth.guardian.schoolId,
        OR: [{ classId: null }, { classId: student.section.classId }],
      },
    });
    if (!feeStructure) return NextResponse.json({ error: "Fee not found for this student" }, { status: 404 });

    const existingPaid = await prisma.feePayment.findFirst({
      where: {
        schoolId: auth.guardian.schoolId,
        studentId: data.studentId,
        feeStructureId: data.feeStructureId,
        status: "PAID",
      },
      select: { id: true },
    });
    if (existingPaid) return NextResponse.json({ error: "Fee already paid" }, { status: 409 });

    const existingPending = await prisma.feePayment.findFirst({
      where: {
        schoolId: auth.guardian.schoolId,
        studentId: data.studentId,
        feeStructureId: data.feeStructureId,
        status: "PENDING",
        paymentGateway: "RAZORPAY",
        gatewayOrderId: { not: null },
      },
      orderBy: { createdAt: "desc" },
    });

    const { keyId } = getRazorpayConfig();
    if (existingPending?.gatewayOrderId) {
      return NextResponse.json({
        keyId,
        orderId: existingPending.gatewayOrderId,
        paymentId: existingPending.id,
        amount: paiseFromRupees(existingPending.amount),
        amountRupees: moneyToNumber(existingPending.amount),
        currency: "INR",
      });
    }

    const amountPaise = paiseFromRupees(feeStructure.amount);
    const order = await createRazorpayOrder({
      amountPaise,
      receipt: `fee_${Date.now()}`,
      notes: {
        schoolId: auth.guardian.schoolId,
        studentId: data.studentId,
        feeStructureId: data.feeStructureId,
      },
    });

    const payment = await prisma.feePayment.create({
      data: {
        amount: feeStructure.amount,
        method: "ONLINE",
        paymentGateway: "RAZORPAY",
        gatewayOrderId: order.id,
        status: "PENDING",
        studentId: data.studentId,
        feeStructureId: data.feeStructureId,
        schoolId: auth.guardian.schoolId,
      },
    });

    return NextResponse.json({
      keyId,
      orderId: order.id,
      paymentId: payment.id,
      amount: order.amount,
      amountRupees: moneyToNumber(payment.amount),
      currency: order.currency,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    console.error("Create Razorpay order error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Internal server error" }, { status: 500 });
  }
}
