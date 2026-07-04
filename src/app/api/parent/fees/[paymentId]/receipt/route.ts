import { NextRequest, NextResponse } from "next/server";
import { format } from "date-fns";
import { prisma } from "@/lib/prisma";
import { auth as adminAuth } from "@/lib/auth";
import { generateReceiptPdf } from "@/lib/receipt-pdf";
import { moneyToNumber } from "@/lib/money";
import { getAuthenticatedGuardian, guardianCanAccessStudent } from "@/lib/parent-auth";
import { canAccessSchool } from "@/lib/tenant";
import { requireSchoolFeature } from "@/lib/feature-flags";

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
        school: { select: { name: true } },
        student: {
          select: {
            id: true,
            name: true,
            section: { select: { name: true, class: { select: { name: true } } } },
          },
        },
        feeStructure: { select: { name: true } },
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

    const pdf = generateReceiptPdf({
      schoolName: payment.school.name,
      studentName: payment.student.name,
      classSection: `${payment.student.section.class.name}-${payment.student.section.name}`,
      feeTitle: payment.feeStructure.name,
      amount: `Rs. ${moneyToNumber(payment.amount).toLocaleString("en-IN")}`,
      paymentMethod: payment.method ?? payment.paymentGateway ?? "MANUAL",
      receiptNumber: payment.receiptNumber,
      paidAt: format(payment.paidAt, "dd MMM yyyy, hh:mm a"),
      referenceNumber: payment.referenceNumber,
      gatewayPaymentId: payment.gatewayPaymentId,
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
