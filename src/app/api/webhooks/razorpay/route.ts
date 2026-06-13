import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRazorpayWebhookSignature } from "@/lib/razorpay";

function receiptNumber(paymentId: string) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `SS-${date}-${paymentId.slice(-8).toUpperCase()}`;
}

function getNestedString(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : undefined;
}

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get("x-razorpay-signature");
    const body = await req.text();

    if (!signature || !verifyRazorpayWebhookSignature(body, signature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const event = JSON.parse(body) as unknown;
    const eventName = getNestedString(event, ["event"]);
    const orderId = getNestedString(event, ["payload", "payment", "entity", "order_id"]);
    const paymentId = getNestedString(event, ["payload", "payment", "entity", "id"]);

    if (!orderId || !paymentId) {
      return NextResponse.json({ received: true });
    }

    const payment = await prisma.feePayment.findFirst({
      where: { gatewayOrderId: orderId, paymentGateway: "RAZORPAY" },
      select: { id: true, status: true, receiptNumber: true, gatewayPaymentId: true },
    });

    if (!payment) return NextResponse.json({ received: true });

    if (eventName === "payment.captured" || eventName === "order.paid") {
      if (payment.status === "PENDING") {
        await prisma.feePayment.update({
          where: { id: payment.id },
          data: {
            status: "PAID",
            paidAt: new Date(),
            gatewayPaymentId: paymentId,
            receiptNumber: payment.receiptNumber ?? receiptNumber(payment.id),
          },
        });
      }
    }

    if (eventName === "payment.failed" && payment.status === "PENDING") {
      await prisma.feePayment.update({
        where: { id: payment.id },
        data: {
          status: "FAILED",
          gatewayPaymentId: paymentId,
        },
      });
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Razorpay webhook error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook processing failed" },
      { status: error instanceof Error && error.message.includes("Razorpay") ? 503 : 500 }
    );
  }
}
