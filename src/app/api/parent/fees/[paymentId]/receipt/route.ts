import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { auth as adminAuth } from "@/lib/auth";
import { generateReceiptPdf } from "@/lib/receipt-pdf";
import { moneyToNumber } from "@/lib/money";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { canAccessSchool } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";
import { enforceActorRateLimit } from "@/lib/api-cost-guard";
import { calculateStudentFeeTotals } from "@/lib/student-fee-ledger";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ paymentId: string }> }
) {
  try {
    const { paymentId } = await params;
    const auth = await getAuthenticatedGuardian(req);
    const session = auth ? null : await adminAuth();
    if (!auth && !session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (auth) {
      const denied = await requireSchoolFeature(auth.guardian.schoolId, "FEES");
      if (denied) return denied;
    }

    const payment = await prisma.feePayment.findFirst({
      where: {
        id: paymentId,
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

    if (auth) {
      if (payment.schoolId !== auth.guardian.schoolId) {
        return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
      }
      if (!(await guardianCanAccessStudent(auth.guardian.id, auth.guardian.schoolId, payment.studentId))) {
        return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
      }
    } else if (!session?.user?.id || !(await canAccessSchool(payment.schoolId, session.user.id))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    } else {
      const denied = await requireSchoolFeature(payment.schoolId, "FEES");
      if (denied) return denied;
    }
    {
      const rateDenied = await enforceActorRateLimit(
        auth
          ? { schoolId: auth.guardian.schoolId, actorType: "PARENT", actorId: auth.guardian.id }
          : { schoolId: payment.schoolId, actorType: "ADMIN_STAFF", actorId: session!.user!.id! },
        "PDF"
      );
      if (rateDenied) return rateDenied;
    }

    // Ledger context: paid-till-date across all PAID records for this
    // student+fee structure, and the remaining balance (Decimal-safe via the
    // money helper — no floating-point money math).
    const paidAggregate = await prisma.feePayment.aggregate({
      where: {
        schoolId: payment.schoolId,
        studentId: payment.studentId,
        feeStructureId: payment.feeStructureId,
        status: "PAID",
      },
      _sum: { amount: true },
    });
    const totalFee = moneyToNumber(payment.feeStructure.amount);
    const paidTillDate = moneyToNumber(paidAggregate._sum.amount ?? 0);
    const totals = calculateStudentFeeTotals(totalFee, paidTillDate);

    // A legacy ONLINE record has a paymentGateway set; new manual records never
    // do, so the gateway id is only surfaced for historical online receipts.
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
      remarks: payment.notes,
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
    console.error("Receipt generation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
