import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { generateReceiptPdf } from "@/lib/receipt-pdf";
import { moneyToNumber } from "@/lib/money";
import { getStudentAuth } from "@/lib/student-mobile-auth";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { calculateStudentFeeTotals } from "@/lib/student-fee-ledger";

// Mirrors GET /api/parent/fees/[paymentId]/receipt — scoped to the
// authenticated Student's own payment instead of a guardian-linked child's.
// notes/recordedById are internal admin fields and are deliberately never
// surfaced here (the parent route selects the full row; this one doesn't).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  try {
    const { paymentId } = await params;
    const auth = await getStudentAuth(req);
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const featureDenied = await requireSchoolFeature(auth.schoolId, "FEES");
    if (featureDenied) return featureDenied;

    const rateDenied = await enforceActorRateLimit(
      { schoolId: auth.schoolId, actorType: "STUDENT", actorId: auth.studentId },
      "PDF"
    );
    if (rateDenied) return rateDenied;

    const payment = await prisma.feePayment.findFirst({
      where: {
        id: paymentId,
        schoolId: auth.schoolId,
        studentId: auth.studentId,
        status: "PAID",
      },
      include: {
        school: { select: { name: true, logoUrl: true } },
        student: {
          select: {
            id: true,
            name: true,
            admissionNo: true,
            section: { select: { name: true, class: { select: { name: true } } } },
          },
        },
        feeStructure: { select: { name: true, amount: true } },
      },
    });

    if (!payment || !payment.paidAt || !payment.receiptNumber) {
      return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
    }

    const paidAggregate = await prisma.feePayment.aggregate({
      where: {
        schoolId: auth.schoolId,
        studentId: auth.studentId,
        feeStructureId: payment.feeStructureId,
        status: "PAID",
      },
      _sum: { amount: true },
    });
    const totalFee = moneyToNumber(payment.feeStructure.amount);
    const paidTillDate = moneyToNumber(paidAggregate._sum.amount ?? 0);
    const totals = calculateStudentFeeTotals(totalFee, paidTillDate);

    const isLegacyOnline = Boolean(payment.paymentGateway);

    const pdf = generateReceiptPdf({
      schoolName: payment.school.name,
      studentName: payment.student.name,
      admissionNo: payment.student.admissionNo,
      classSection: `${payment.student.section.class.name}-${payment.student.section.name}`,
      feeTitle: payment.feeStructure.name,
      amount: `Rs. ${moneyToNumber(payment.amount).toLocaleString("en-IN")}`,
      paymentMethod: payment.method ?? payment.paymentGateway ?? "MANUAL",
      receiptNumber: payment.receiptNumber,
      paidAt: format(payment.paidAt, "dd MMM yyyy, hh:mm a"),
      referenceNumber: payment.referenceNumber,
      remarks: null,
      paidTillDate: `Rs. ${totals.paidTillDate.toLocaleString("en-IN")}`,
      remainingAmount: `Rs. ${totals.remainingAmount.toLocaleString("en-IN")}`,
      gatewayPaymentId: isLegacyOnline ? payment.gatewayPaymentId : null,
    });

    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${payment.receiptNumber}.pdf"`,
      },
    });
  } catch (error) {
    console.error("Student receipt generation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
