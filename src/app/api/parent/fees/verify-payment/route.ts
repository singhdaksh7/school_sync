import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { moneyToNumber } from "@/lib/money";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { verifyRazorpayPaymentSignature } from "@/lib/razorpay";
import { getClientIp } from "@/lib/request-ip";
import { rateLimit, RATE_LIMIT_POLICIES } from "@/lib/rate-limit";

const schema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

function receiptNumber(paymentId: string) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `SS-${date}-${paymentId.slice(-8).toUpperCase()}`;
}

function withoutGatewaySignature<T extends { gatewaySignature?: string | null }>(payment: T) {
  const safePayment = { ...payment };
  delete safePayment.gatewaySignature;
  return safePayment;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthenticatedGuardian(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const limit = await rateLimit(`payment-verify:${getClientIp(req) ?? auth.guardian.id}`, RATE_LIMIT_POLICIES.payment);
    if (!limit.allowed) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });

    const data = schema.parse(await req.json());
    const payment = await prisma.feePayment.findFirst({
      where: {
        schoolId: auth.guardian.schoolId,
        gatewayOrderId: data.razorpay_order_id,
        paymentGateway: "RAZORPAY",
      },
      include: { feeStructure: { select: { name: true, amount: true } } },
    });
    if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404 });

    if (!(await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, payment.studentId))) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    if (payment.status === "FAILED") {
      return NextResponse.json({ error: "Payment is already marked failed" }, { status: 409 });
    }

    if (!verifyRazorpayPaymentSignature({
      orderId: data.razorpay_order_id,
      paymentId: data.razorpay_payment_id,
      signature: data.razorpay_signature,
    })) {
      return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });
    }

    if (payment.status === "PAID") {
      if (payment.gatewayPaymentId && payment.gatewayPaymentId !== data.razorpay_payment_id) {
        return NextResponse.json({ error: "Payment already verified with a different gateway payment" }, { status: 409 });
      }
      const safePayment = withoutGatewaySignature(payment);
      return NextResponse.json({
        success: true,
        payment: {
          ...safePayment,
          amount: moneyToNumber(payment.amount),
          feeStructure: {
            ...payment.feeStructure,
            amount: moneyToNumber(payment.feeStructure.amount),
          },
        },
      });
    }

    const updatedPayment = await prisma.feePayment.update({
          where: { id: payment.id },
          data: {
            status: "PAID",
            paidAt: new Date(),
            gatewayPaymentId: data.razorpay_payment_id,
            gatewaySignature: data.razorpay_signature,
            receiptNumber: payment.receiptNumber ?? receiptNumber(payment.id),
          },
          include: { feeStructure: { select: { name: true, amount: true } } },
        });

    const safePayment = withoutGatewaySignature(updatedPayment);
    return NextResponse.json({
      success: true,
      payment: {
        ...safePayment,
        amount: moneyToNumber(updatedPayment.amount),
        feeStructure: {
          ...updatedPayment.feeStructure,
          amount: moneyToNumber(updatedPayment.feeStructure.amount),
        },
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    console.error("Verify Razorpay payment error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: error instanceof Error && error.message.includes("Razorpay") ? 503 : 500 }
    );
  }
}
